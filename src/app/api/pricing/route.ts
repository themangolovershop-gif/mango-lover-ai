import { NextResponse } from "next/server";
import { getPrismaClient } from "@/backend/shared/lib/prisma";
import { ProductSize } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PRICES = {
  MEDIUM: { retail: 1499, corporate: 2999, name: "Medium", slug: "medium" },
  LARGE: { retail: 1999, corporate: 3499, name: "Large", slug: "large" },
  JUMBO: { retail: 2499, corporate: 3999, name: "Jumbo", slug: "jumbo" },
};

export async function GET() {
  try {
    const prisma = getPrismaClient();

    let products = await prisma.product.findMany({
      where: { active: true },
      orderBy: { createdAt: "asc" },
    });

    // If no products exist, seed them automatically
    if (products.length === 0) {
      console.log("[PRICING-API] No products found in DB. Seeding defaults...");
      const seeded = [];
      for (const [size, meta] of Object.entries(DEFAULT_PRICES)) {
        const p = await prisma.product.create({
          data: {
            name: meta.name,
            slug: meta.slug,
            size: size as ProductSize,
            price: meta.retail,
            corporatePrice: meta.corporate,
            active: true,
          },
        });
        seeded.push(p);
      }
      products = seeded;
    }

    return NextResponse.json(
      products.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        size: p.size,
        price: Number(p.price.toString()),
        corporatePrice: Number(p.corporatePrice.toString()),
      }))
    );
  } catch (error) {
    console.error("[PRICING-API-ERROR] Failed to fetch/seed products:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const prisma = getPrismaClient();
    const body = await request.json();

    const { prices } = body;
    if (!prices) {
      return NextResponse.json({ error: "Missing prices in request body" }, { status: 400 });
    }

    const updated = [];
    for (const [size, rates] of Object.entries(prices)) {
      const rate = rates as { retail: number; corporate: number };
      const product = await prisma.product.findFirst({
        where: { size: size as ProductSize, active: true },
      });

      if (product) {
        const p = await prisma.product.update({
          where: { id: product.id },
          data: {
            price: rate.retail,
            corporatePrice: rate.corporate,
          },
        });
        updated.push(p);
      } else {
        // Create if missing in DB
        const meta = DEFAULT_PRICES[size as keyof typeof DEFAULT_PRICES];
        const p = await prisma.product.create({
          data: {
            name: meta?.name || size,
            slug: meta?.slug || size.toLowerCase(),
            size: size as ProductSize,
            price: rate.retail,
            corporatePrice: rate.corporate,
            active: true,
          },
        });
        updated.push(p);
      }
    }

    return NextResponse.json({ success: true, updated });
  } catch (error) {
    console.error("[PRICING-API-ERROR] Failed to update pricing:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
