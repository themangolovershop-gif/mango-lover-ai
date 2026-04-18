import { getPrismaClient } from "@/backend/shared/lib/prisma";
import { Customer } from "@prisma/client";

export class IdentityResolutionService {
  private prisma = getPrismaClient();

  async resolve(params: {
    handle?: string;
    provider?: string;
    phone?: string;
    email?: string;
    name?: string;
  }): Promise<Customer | null> {
    
    // 1. Try by phone (Primary)
    if (params.phone) {
      const customer = await this.prisma.customer.findUnique({
        where: { phone: params.phone }
      });
      if (customer) return customer;
    }

    // 2. Try by email
    if (params.email) {
      const customer = await this.prisma.customer.findFirst({
        where: { email: params.email }
      });
      if (customer) return customer;
    }

    // 3. Try by social handle
    if (params.handle && params.provider) {
      const identity = await (this.prisma as any).customerSocialIdentity.findUnique({
        where: { 
          provider_handle: { 
            provider: params.provider, 
            handle: params.handle 
          } 
        },
        include: { customer: true }
      });
      if (identity) return identity.customer;
    }

    // 4. Fallback: Fuzzy match by name (Careful!)
    if (params.name) {
      const customer = await this.prisma.customer.findFirst({
        where: { 
          name: { contains: params.name, mode: "insensitive" } 
        }
      });
      if (customer) return customer;
    }

    return null;
  }

  async linkIdentity(customerId: string, provider: string, handle: string) {
    return (this.prisma as any).customerSocialIdentity.upsert({
      where: { provider_handle: { provider, handle } },
      update: { customerId },
      create: { customerId, provider, handle }
    });
  }
}
