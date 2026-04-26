import { OrderStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { getPrismaClient } from "@/backend/shared/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapOrderStatus(status: OrderStatus) {
  switch (status) {
    case OrderStatus.DRAFT:
      return "draft";
    case OrderStatus.AWAITING_CONFIRMATION:
      return "awaiting_confirmation";
    case OrderStatus.CONFIRMED:
      return "confirmed";
    case OrderStatus.CANCELLED:
      return "cancelled";
    default:
      return "draft";
  }
}

function formatDeliveryAddress(order: Awaited<ReturnType<typeof getOrder>>) {
  const address = order?.customer.addresses.find((entry) => entry.isDefault) ?? order?.customer.addresses[0];
  if (!address) {
    return null;
  }

  return [address.line1, address.line2, address.area, address.landmark, address.city, address.state, address.pinCode]
    .filter(Boolean)
    .join(", ");
}

async function getOrder(conversationId: string) {
  const prisma = getPrismaClient();

  return prisma.order.findFirst({
    where: {
      conversationId,
      status: {
        in: [OrderStatus.DRAFT, OrderStatus.AWAITING_CONFIRMATION, OrderStatus.CONFIRMED],
      },
    },
    include: {
      customer: {
        include: {
          addresses: {
            orderBy: {
              updatedAt: "desc",
            },
          },
        },
      },
      items: {
        include: {
          product: true,
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const order = await getOrder(id);

    if (!order) {
      return NextResponse.json(null);
    }

    const firstItem = order.items[0];
    const productSize = firstItem?.product.size.toLowerCase() ?? null;

    return NextResponse.json({
      id: order.id,
      conversation_id: order.conversationId,
      customer_name: order.customer.name,
      phone: order.customer.phone,
      product_size: productSize,
      quantity: firstItem?.quantity ?? null,
      delivery_address: formatDeliveryAddress(order),
      delivery_date: null,
      order_type: "personal",
      status: mapOrderStatus(order.status),
      notes: order.notes,
      created_at: order.createdAt.toISOString(),
      updated_at: order.updatedAt.toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load order" },
      { status: 500 }
    );
  }
}
