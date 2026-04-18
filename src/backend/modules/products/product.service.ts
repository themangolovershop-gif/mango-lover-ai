import { Prisma, ProductSize } from '@prisma/client';

import { toDecimal, type DecimalInput } from '@/backend/modules/orders/order-calculations';
import { NotFoundError, ValidationError } from '@/backend/shared/lib/errors/app-error';
import { getPrismaClient } from '@/backend/shared/lib/prisma';

export type ListProductsFilters = {
  active?: boolean;
  size?: ProductSize;
  search?: string;
  limit?: number;
};

export type CreateProductInput = {
  name: string;
  slug: string;
  size: ProductSize;
  price: DecimalInput;
  active?: boolean;
  cityRulesJson?: Prisma.InputJsonValue | null;
  deliveryRulesJson?: Prisma.InputJsonValue | null;
};

export type UpdateProductInput = {
  name?: string;
  slug?: string;
  size?: ProductSize;
  price?: DecimalInput;
  active?: boolean;
  cityRulesJson?: Prisma.InputJsonValue | null;
  deliveryRulesJson?: Prisma.InputJsonValue | null;
};

function hasOwnProperty<T extends object>(value: T, key: keyof T) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeName(name: string) {
  const normalized = name.trim();

  if (!normalized) {
    throw new ValidationError('Product name is required.');
  }

  return normalized;
}

function normalizeSlug(slug: string) {
  const normalized = slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalized) {
    throw new ValidationError('Product slug is required.');
  }

  return normalized;
}

function normalizePrice(price: DecimalInput) {
  const decimal = toDecimal(price, 'price').toDecimalPlaces(2);

  if (decimal.lessThanOrEqualTo(0)) {
    throw new ValidationError('Product price must be greater than zero.');
  }

  return decimal;
}

function buildProductWhere(filters: ListProductsFilters): Prisma.ProductWhereInput {
  return {
    ...(filters.active !== undefined ? { active: filters.active } : {}),
    ...(filters.size ? { size: filters.size } : {}),
    ...(filters.search
      ? {
          OR: [
            {
              name: {
                contains: filters.search,
                mode: 'insensitive',
              },
            },
            {
              slug: {
                contains: filters.search.toLowerCase(),
                mode: 'insensitive',
              },
            },
          ],
        }
      : {}),
  };
}

export async function listProducts(filters: ListProductsFilters = {}) {
  const prisma = getPrismaClient();

  return prisma.product.findMany({
    where: buildProductWhere(filters),
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    take: filters.limit ?? 100,
  });
}

export async function getProductById(productId: string) {
  const prisma = getPrismaClient();
  const product = await prisma.product.findUnique({
    where: {
      id: productId,
    },
  });

  if (!product) {
    throw new NotFoundError(`Product ${productId} was not found.`);
  }

  return product;
}

export async function getProductBySlug(slug: string) {
  const prisma = getPrismaClient();
  const product = await prisma.product.findUnique({
    where: {
      slug: normalizeSlug(slug),
    },
  });

  if (!product) {
    throw new NotFoundError(`Product ${slug} was not found.`);
  }

  return product;
}

export async function getActiveProductBySize(size: ProductSize) {
  const prisma = getPrismaClient();
  const product = await prisma.product.findFirst({
    where: {
      size,
      active: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  if (!product) {
    throw new NotFoundError(`No active product found for size ${size}.`);
  }

  return product;
}

export async function createProduct(input: CreateProductInput) {
  const prisma = getPrismaClient();

  return prisma.product.create({
    data: {
      name: normalizeName(input.name),
      slug: normalizeSlug(input.slug),
      size: input.size,
      price: normalizePrice(input.price),
      active: input.active ?? true,
      cityRulesJson: input.cityRulesJson ?? undefined,
      deliveryRulesJson: input.deliveryRulesJson ?? undefined,
    },
  });
}

export async function updateProduct(productId: string, input: UpdateProductInput) {
  const prisma = getPrismaClient();
  await getProductById(productId);

  const data: Prisma.ProductUpdateInput = {};

  if (input.name !== undefined) {
    data.name = normalizeName(input.name);
  }

  if (input.slug !== undefined) {
    data.slug = normalizeSlug(input.slug);
  }

  if (input.size !== undefined) {
    data.size = input.size;
  }

  if (input.price !== undefined) {
    data.price = normalizePrice(input.price);
  }

  if (input.active !== undefined) {
    data.active = input.active;
  }

  if (hasOwnProperty(input, 'cityRulesJson')) {
    data.cityRulesJson = input.cityRulesJson ?? Prisma.JsonNull;
  }

  if (hasOwnProperty(input, 'deliveryRulesJson')) {
    data.deliveryRulesJson = input.deliveryRulesJson ?? Prisma.JsonNull;
  }

  return prisma.product.update({
    where: {
      id: productId,
    },
    data,
  });
}

export async function deactivateProduct(productId: string) {
  return updateProduct(productId, {
    active: false,
  });
}
