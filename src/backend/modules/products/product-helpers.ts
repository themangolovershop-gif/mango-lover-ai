import { ProductSize } from '@prisma/client';

export function mapSizeToProductSize(size?: string | null) {
  switch (size?.toLowerCase()) {
    case 'medium':
      return ProductSize.MEDIUM;
    case 'large':
      return ProductSize.LARGE;
    case 'jumbo':
      return ProductSize.JUMBO;
    default:
      return null;
  }
}
