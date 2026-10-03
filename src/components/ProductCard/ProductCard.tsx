import { Cell } from '@telegram-apps/telegram-ui';
import type { FC } from 'react';

import type { Product } from '@/api/types.ts';
import { Link } from '@/components/Link/Link.tsx';
import { formatPrice } from '@/helpers/formatPrice.ts';

interface ProductCardProps {
  product: Product;
}

export const ProductCard: FC<ProductCardProps> = ({ product }) => {
  const outOfStock = product.stockQty <= 0;

  return (
    <Link to={`/product/${product.id}`}>
      <Cell
        subtitle={`Артикул: ${product.code}`}
        after={<span style={{ whiteSpace: 'nowrap' }}>{formatPrice(product.price)}</span>}
        description={outOfStock ? 'Нет в наличии' : `В наличии: ${product.stockQty} шт.`}
      >
        {product.name}
      </Cell>
    </Link>
  );
};
