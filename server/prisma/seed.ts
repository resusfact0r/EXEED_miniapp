import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const products = [
  { code: 'A-1001', name: 'Тормозные колодки передние', price: 1890, stockQty: 40 },
  { code: 'A-1002', name: 'Тормозные колодки задние', price: 1650, stockQty: 35 },
  { code: 'A-1003', name: 'Масляный фильтр', price: 420, stockQty: 120 },
  { code: 'A-1004', name: 'Воздушный фильтр', price: 590, stockQty: 90 },
  { code: 'A-1005', name: 'Салонный фильтр', price: 650, stockQty: 75 },
  { code: 'A-1006', name: 'Свеча зажигания', price: 340, stockQty: 200 },
  { code: 'A-1007', name: 'Ремень ГРМ', price: 2400, stockQty: 25 },
  { code: 'A-1008', name: 'Комплект ГРМ с роликами', price: 5600, stockQty: 15 },
  { code: 'A-1009', name: 'Амортизатор передний', price: 3200, stockQty: 20 },
  { code: 'A-1010', name: 'Амортизатор задний', price: 2900, stockQty: 20 },
  { code: 'A-1011', name: 'Аккумулятор 60Ah', price: 7800, stockQty: 12 },
  { code: 'A-1012', name: 'Радиатор охлаждения', price: 6100, stockQty: 8 },
  { code: 'A-1013', name: 'Стартер', price: 8900, stockQty: 6 },
  { code: 'A-1014', name: 'Генератор', price: 9700, stockQty: 5 },
  { code: 'A-1015', name: 'Датчик кислорода', price: 990, stockQty: 0 },
];

async function main() {
  for (const product of products) {
    await prisma.product.upsert({
      where: { code: product.code },
      update: product,
      create: product,
    });
  }
  console.log(`Seeded ${products.length} products`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
