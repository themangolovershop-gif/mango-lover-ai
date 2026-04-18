import { ProductSize } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import {
  createProduct,
  getProductById,
  listProducts,
  updateProduct,
} from '@/backend/modules/products/product.service';
import { validateWithSchema } from '@/backend/shared/lib/http/validation';

const productParamsSchema = z.object({
  id: z.string().min(1),
});

const productListQuerySchema = z.object({
  active: z.coerce.boolean().optional(),
  size: z
    .enum(['MEDIUM', 'LARGE', 'JUMBO'])
    .optional() as z.ZodOptional<z.ZodType<ProductSize>>,
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const productBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: z.string().trim().min(1).max(255),
  size: z.enum(['MEDIUM', 'LARGE', 'JUMBO']) as z.ZodType<ProductSize>,
  price: z.union([z.string(), z.number()]),
  active: z.boolean().optional(),
  cityRulesJson: z.record(z.any()).nullable().optional(),
  deliveryRulesJson: z.record(z.any()).nullable().optional(),
});

const productUpdateBodySchema = productBodySchema.partial();

export const productsRouter = Router();

productsRouter.get('/', async (request, response) => {
  const query = validateWithSchema(productListQuerySchema, request.query);
  const products = await listProducts(query);

  response.status(200).json({
    success: true,
    data: products,
  });
});

productsRouter.get('/:id', async (request, response) => {
  const params = validateWithSchema(productParamsSchema, request.params);
  const product = await getProductById(params.id);

  response.status(200).json({
    success: true,
    data: product,
  });
});

productsRouter.post('/', async (request, response) => {
  const body = validateWithSchema(productBodySchema, request.body);
  const product = await createProduct(body);

  response.status(201).json({
    success: true,
    data: product,
  });
});

productsRouter.patch('/:id', async (request, response) => {
  const params = validateWithSchema(productParamsSchema, request.params);
  const body = validateWithSchema(productUpdateBodySchema, request.body);
  const product = await updateProduct(params.id, body);

  response.status(200).json({
    success: true,
    data: product,
  });
});
