#!/usr/bin/env python3
"""Watchdog for exeedbot.ru: notices silent failures and tells the owner.

Every serious problem so far was silent: the bot was down 25 days because its Telegram proxy
died, and the price list stopped updating for 4 days because the supplier changed which emails
they send. Runs every 5 minutes from systemd - outside the Node app, so it still works when the
backend is down - and messages the owner only when a check changes state ("сломалось" /
"снова работает"), plus a reminder every 24 h while something stays broken. When Telegram itself
is unreachable (the proxy-death case), alerts go by email instead.

Also: a morning digest at 09:00 Moscow time, and a reminder to operators about orders that have
been waiting for a payment link too long.

Settings come from /opt/tg-miniapp/server/.env (see .env.example, WATCHDOG_*); environment
variables override them, which is how the checks are tested. WATCHDOG_DRY_RUN=1 prints messages
instead of sending them.
"""
import json
import os
import shutil
import smtplib
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from zoneinfo import ZoneInfo

MSK = ZoneInfo("Europe/Moscow")
NOW = datetime.now(timezone.utc)
WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]


def load_config() -> dict:
    env_file = Path(os.environ.get("WATCHDOG_ENV_FILE", "/opt/tg-miniapp/server/.env"))
    cfg = {}
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                cfg[key.strip()] = value.strip().strip('"')
    cfg.update(os.environ)
    return cfg


CFG = load_config()
DRY = CFG.get("WATCHDOG_DRY_RUN") == "1"
STATE_FILE = Path(CFG.get("WATCHDOG_STATE_FILE", "/var/lib/tg-miniapp-watchdog/state.json"))
BACKEND = CFG.get("WATCHDOG_BACKEND_URL", "http://127.0.0.1:3000/api")
OWNER_CHAT = CFG.get("WATCHDOG_CHAT_ID") or CFG.get("BACKUP_CHAT_ID", "")
OPERATOR_CHATS = [c.strip() for c in CFG.get("ORDER_NOTIFY_CHAT_IDS", "").split(",") if c.strip()]
ALERT_EMAIL = CFG.get("WATCHDOG_EMAIL") or CFG.get("PRICE_IMAP_USER", "")
SMTP_USER = CFG.get("WATCHDOG_SMTP_USER") or CFG.get("PRICE_IMAP_USER", "")
SMTP_PASSWORD = CFG.get("WATCHDOG_SMTP_PASSWORD") or CFG.get("PRICE_IMAP_PASSWORD", "")
SMTP_HOST = CFG.get("WATCHDOG_SMTP_HOST", "smtp.gmail.com")
# "Прайс Chery ЦС" comes every few days, not daily: the longest gap seen so far was 72 Mon-Fri hours.
PRICE_STALE_HOURS = float(CFG.get("WATCHDOG_PRICE_STALE_BUSINESS_HOURS", "80"))
ORDER_REMIND_HOURS = float(CFG.get("WATCHDOG_ORDER_REMIND_HOURS", "2"))
BACKUP_DIR = Path(CFG.get("WATCHDOG_BACKUP_DIR", "/var/backups/tg-miniapp"))
CERT = Path(CFG.get("WATCHDOG_CERT", "/etc/letsencrypt/live/exeedbot.ru/cert.pem"))
REPEAT_AFTER = timedelta(hours=24)


# ---------------------------------------------------------------- sending

def telegram(method: str, payload: dict) -> bool:
    token = CFG.get("TELEGRAM_BOT_TOKEN", "")
    proxy = CFG.get("TELEGRAM_PROXY_URL", "")
    cmd = ["curl", "-sf", "-m", "20", "-H", "Content-Type: application/json", "-d", json.dumps(payload),
           f"https://api.telegram.org/bot{token}/{method}"]
    if proxy:
        cmd[1:1] = ["--proxy", proxy]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode == 0 and '"ok":true' in result.stdout


def email(subject: str, body: str) -> bool:
    if not (ALERT_EMAIL and SMTP_USER and SMTP_PASSWORD):
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_USER
    msg["To"] = ALERT_EMAIL
    msg.set_content(body)
    try:
        with smtplib.SMTP_SSL(SMTP_HOST, 465, timeout=30) as smtp:
            smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(msg)
        return True
    except (OSError, smtplib.SMTPException) as err:
        print(f"email failed: {err}", file=sys.stderr)
        return False


def notify_owner(text: str, silent: bool = False) -> None:
    if DRY:
        print(f"[владельцу{' (тихо)' if silent else ''}] {text}")
        return
    if OWNER_CHAT and telegram("sendMessage", {"chat_id": OWNER_CHAT, "text": text, "disable_notification": silent}):
        return
    # Telegram is down or unreachable (dead proxy) - exactly when the owner most needs to know.
    if not email("exeedbot.ru: " + text.split("\n")[0][:80], text + "\n\n(Отправлено письмом: Telegram недоступен.)"):
        print(f"ALERT NOT DELIVERED: {text}", file=sys.stderr)


def notify_operators(text: str) -> None:
    for chat in OPERATOR_CHATS:
        if DRY:
            print(f"[оператору {chat}] {text}")
        else:
            telegram("sendMessage", {"chat_id": chat, "text": text})


# ---------------------------------------------------------------- helpers

def get_json(path: str):
    # No proxy for localhost, whatever the environment says.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(BACKEND + path, timeout=10) as resp:
        return json.loads(resp.read())


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def msk(dt: datetime) -> str:
    local = dt.astimezone(MSK)
    return f"{WEEKDAYS[local.weekday()]} {local:%d.%m %H:%M}"


def minutes_since(dt: datetime) -> int:
    return int((NOW - dt).total_seconds() // 60)


def business_hours_since(start: datetime) -> float:
    """Hours since `start` counting only Monday-Friday (Moscow time): the supplier doesn't send
    the price list on weekends, so Friday's list is still current on Monday morning."""
    step = timedelta(minutes=15)
    t, total = start, 0.0
    while t < NOW:
        if t.astimezone(MSK).weekday() < 5:
            total += 0.25
        t += step
    return total


def human_duration(minutes: int) -> str:
    if minutes < 60:
        return f"{minutes} мин"
    if minutes < 48 * 60:
        return f"{minutes // 60} ч {minutes % 60} мин"
    return f"{minutes // 1440} дн {minutes // 60 % 24} ч"


# ---------------------------------------------------------------- checks
# Each returns (ok, message). None means "can't tell right now" - the previous state is kept.

def check_backend():
    try:
        return get_json("/health").get("status") == "ok", "не отвечает на /api/health — приложение не работает"
    except Exception as err:  # noqa: BLE001 - any failure means "down"
        return False, f"не отвечает на /api/health ({err}) — приложение не работает"


def check_telegram():
    if not CFG.get("TELEGRAM_BOT_TOKEN"):
        return None
    proxy = CFG.get("TELEGRAM_PROXY_URL", "")
    host = proxy.rsplit("@", 1)[-1] if proxy else "без прокси"
    return telegram("getMe", {}), f"api.telegram.org не отвечает (прокси {host}) — бот не получает и не отправляет сообщения"


def check_bot_polling(details):
    bot = details["bot"]
    if not bot["enabled"]:
        return None
    since = parse_time(bot["lastOkAt"]) or parse_time(bot["startedAt"])
    age = minutes_since(since)
    return age <= 10, f"бот не получает сообщения от Telegram уже {human_duration(age)}"


def check_mail(details):
    sync = details["priceSync"]
    if not sync["enabled"]:
        return None
    since = parse_time(sync["lastCheckOkAt"]) or parse_time(sync["startedAt"])
    age = minutes_since(since)
    return age <= 60, (f"почта с прайсом не проверяется уже {human_duration(age)} "
                       f"({sync['consecutiveFailures']} неудачных попыток подряд, ошибка: {sync['lastError'] or '—'})")


def check_price_stale(details):
    sync = details["priceSync"]
    last = details["prices"]["lastApplied"]
    if not sync["enabled"] or not last:
        return None
    applied_at = parse_time(last["receivedAt"]) or parse_time(last["createdAt"])
    hours = business_hours_since(applied_at)
    if hours <= PRICE_STALE_HOURS:
        return True, ""
    lines = [f"прайс не обновлялся {hours:.0f} рабочих часов — последний применён {msk(applied_at)} "
             f"({last['rows']} позиций). Каталог показывает старые цены и остатки."]
    others = [m for m in sync["supplierMail"] if not m["matched"] and parse_time(m["lastAt"]) > applied_at]
    if others:
        lines.append(f"Под фильтр «{sync['filter']}» ничего не пришло, а от поставщика за это время были:")
        lines += [f"  • «{m['subject']}» ×{m['count']}" for m in others]
    return False, "\n".join(lines)


def check_backup():
    dumps = sorted(BACKUP_DIR.glob("tg-miniapp_*.dump"), key=lambda p: p.stat().st_mtime)
    if not dumps:
        return False, f"в {BACKUP_DIR} нет ни одного бэкапа"
    newest = datetime.fromtimestamp(dumps[-1].stat().st_mtime, timezone.utc)
    if NOW - newest > timedelta(hours=26):
        return False, f"последний бэкап {msk(newest)} — ночной бэкап не сделан"
    result = subprocess.run(["systemctl", "show", "tg-miniapp-backup.service", "-p", "Result", "--value"],
                            capture_output=True, text=True).stdout.strip()
    if result and result != "success":
        return False, f"бэкап сделан, но не отправлен в Telegram (результат: {result}). Лог: journalctl -u tg-miniapp-backup"
    return True, ""


def check_disk():
    usage = shutil.disk_usage("/")
    pct = usage.used * 100 / usage.total
    return pct <= 85, f"диск занят на {pct:.0f}% (свободно {usage.free // 2**30} ГБ)"


def check_cert():
    if not CERT.exists():
        return None
    out = subprocess.run(["openssl", "x509", "-enddate", "-noout", "-in", str(CERT)], capture_output=True, text=True).stdout
    try:
        ends = datetime.strptime(out.strip().split("=", 1)[1], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    except (IndexError, ValueError):
        return None
    days = (ends - NOW).days
    return days >= 14, f"TLS-сертификат истекает через {days} дн ({ends:%d.%m.%Y}) — certbot не продлил его. Проверьте: certbot renew --dry-run"


CHECKS = {
    # key: (title, consecutive failures before alerting)
    "backend": ("Приложение", 2),
    "telegram": ("Telegram", 2),
    "bot_polling": ("Бот", 1),
    "mail": ("Почта с прайсом", 1),
    "price_stale": ("Прайс", 1),
    "backup": ("Бэкап", 1),
    "disk": ("Диск", 1),
    "cert": ("Сертификат", 1),
}


# ---------------------------------------------------------------- main

def main() -> int:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    state = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}
    checks_state = state.setdefault("checks", {})

    results = {"backend": check_backend(), "telegram": check_telegram(),
               "backup": check_backup(), "disk": check_disk(), "cert": check_cert()}
    details = None
    if results["backend"][0]:
        try:
            details = get_json("/health/details")
        except Exception as err:  # noqa: BLE001
            print(f"details unavailable: {err}", file=sys.stderr)
    if details:
        # A dead Telegram link already explains a silent bot - don't send two alerts for it.
        telegram_ok = results["telegram"] is None or results["telegram"][0]
        results["bot_polling"] = check_bot_polling(details) if telegram_ok else None
        results["mail"] = check_mail(details)
        results["price_stale"] = check_price_stale(details)

    for key, result in results.items():
        if result is None:
            continue
        ok, message = result
        title, needed = CHECKS[key]
        st = checks_state.setdefault(key, {"status": "ok", "fails": 0})
        if ok:
            if st["status"] == "fail":
                down = minutes_since(parse_time(st["since"]))
                notify_owner(f"🟢 {title}: снова в порядке (не работало {human_duration(down)}).")
            checks_state[key] = {"status": "ok", "fails": 0}
            continue
        st["fails"] = st.get("fails", 0) + 1
        if st["status"] == "ok" and st["fails"] >= needed:
            st.update(status="fail", since=NOW.isoformat(), alerted=NOW.isoformat())
            notify_owner(f"🔴 {title}: {message}")
        elif st["status"] == "fail" and NOW - parse_time(st["alerted"]) > REPEAT_AFTER:
            st["alerted"] = NOW.isoformat()
            notify_owner(f"🔴 {title} — всё ещё не работает ({human_duration(minutes_since(parse_time(st['since'])))}): {message}")

    if details:
        remind_operators(details, state)
        send_digest(details, state, checks_state)

    if CFG.get("WATCHDOG_PING_URL") and not DRY:
        # Dead man's switch: if these pings stop, the external service emails the owner - the
        # only way to hear about the whole server being down.
        subprocess.run(["curl", "-fsS", "-m", "10", "--retry", "3", CFG["WATCHDOG_PING_URL"]], capture_output=True)

    state["lastRun"] = NOW.isoformat()
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=1))
    STATE_FILE.chmod(0o600)
    failing = [k for k, v in checks_state.items() if v["status"] == "fail"]
    print(f"watchdog: {'всё в порядке' if not failing else 'не работает: ' + ', '.join(failing)}")
    return 0


def remind_operators(details, state) -> None:
    """An order waiting for a payment link is a customer waiting. Remind once per order, and not
    at night."""
    reminded = set(state.get("remindedOrders", []))
    waiting = details["orders"]["awaitingLink"]
    hour = NOW.astimezone(MSK).hour
    for order in waiting:
        created = parse_time(order["createdAt"])
        if order["orderNumber"] in reminded or NOW - created < timedelta(hours=ORDER_REMIND_HOURS) or not 9 <= hour < 21:
            continue
        notify_operators(f"⏰ Заказ №{order['orderNumber']} ({order['totalAmount']} ₽) ждёт ссылку на оплату уже "
                         f"{human_duration(minutes_since(created))}.\nКарточка: /order {order['orderNumber']}")
        reminded.add(order["orderNumber"])
    # Forget orders that have moved on, so the list doesn't grow forever.
    state["remindedOrders"] = sorted(reminded & {o["orderNumber"] for o in waiting})


def send_digest(details, state, checks_state) -> None:
    """Once a day at 09:00 Moscow time: proof that everything works. No digest is a signal too."""
    local = NOW.astimezone(MSK)
    today = local.strftime("%Y-%m-%d")
    if local.hour < 9 or state.get("digestDate") == today:
        return
    state["digestDate"] = today

    prices = details["prices"]
    last = prices["lastApplied"]
    if last:
        applied_at = parse_time(last["receivedAt"]) or parse_time(last["createdAt"])
        stale = checks_state.get("price_stale", {}).get("status") == "fail"
        price_line = f"{'⚠️' if stale else '✅'} Прайс: {msk(applied_at)}, {last['rows']} позиций; в каталоге {prices['activeProducts']}"
    else:
        price_line = "⚠️ Прайс: ещё ни разу не применён из почты"
    dumps = sorted(BACKUP_DIR.glob("tg-miniapp_*.dump"), key=lambda p: p.stat().st_mtime)
    if dumps:
        newest = dumps[-1]
        backup_ok = checks_state.get("backup", {}).get("status") != "fail"
        backup_line = (f"{'✅' if backup_ok else '⚠️'} Бэкап: "
                       f"{msk(datetime.fromtimestamp(newest.stat().st_mtime, timezone.utc))}, {newest.stat().st_size / 2**20:.1f} МБ")
    else:
        backup_line = "⚠️ Бэкап: нет файлов"
    orders = details["orders"]
    failing = [CHECKS[k][0] for k, v in checks_state.items() if v["status"] == "fail"]
    lines = [
        f"☀️ Сводка exeedbot.ru на {local:%d.%m}",
        price_line,
        backup_line,
        f"🧾 Заказы: за сутки {orders['createdLastDay']}, ждут ссылку {len(orders['awaitingLink'])}, "
        f"ждут оплаты {orders['awaitingPayment']}, в работе {orders['inWork']}",
        "⚠️ Сейчас не работает: " + ", ".join(failing) if failing else "Проблем нет.",
    ]
    notify_owner("\n".join(lines), silent=True)


if __name__ == "__main__":
    sys.exit(main())
