import {
  Body,
  Controller,
  Get,
  Post,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../../../common/guards/organization.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

interface ConnectShopifyDto {
  shopDomain: string;
  accessToken: string;
  shopName?: string;
}

@Controller('integrations/ecommerce')
@UseGuards(JwtAuthGuard, OrganizationGuard, RolesGuard)
@Roles('OWNER', 'ADMIN', 'MANAGER')
export class EcommerceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getStatus(@Req() req: any) {
    const integration = await this.prisma.integration.findUnique({
      where: {
        organizationId_provider: {
          organizationId: req.organizationId,
          provider: 'ecommerce',
        },
      },
    });

    if (!integration) {
      return { connected: false, provider: null };
    }

    const config = (integration.configuration || {}) as any;
    return {
      connected: integration.status === 'ACTIVE',
      provider: config.provider,
      shopName: config.shopName,
      shopDomain: config.shopDomain,
      status: integration.status,
    };
  }

  @Post('shopify')
  @HttpCode(HttpStatus.OK)
  async connectShopify(@Body() dto: ConnectShopifyDto, @Req() req: any) {
    const cleanDomain = dto.shopDomain
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
      .replace(/\.myshopify\.com.*$/, '.myshopify.com');

    const integration = await this.prisma.integration.upsert({
      where: {
        organizationId_provider: {
          organizationId: req.organizationId,
          provider: 'ecommerce',
        },
      },
      update: {
        status: 'ACTIVE',
        configuration: {
          provider: 'shopify',
          shopName: dto.shopName || cleanDomain.replace('.myshopify.com', ''),
          shopDomain: cleanDomain,
        },
      },
      create: {
        id: uuidv4(),
        organizationId: req.organizationId,
        provider: 'ecommerce',
        name: `Shopify - ${dto.shopName || cleanDomain}`,
        type: 'COMMERCE',
        status: 'ACTIVE',
        configuration: {
          provider: 'shopify',
          shopName: dto.shopName || cleanDomain.replace('.myshopify.com', ''),
          shopDomain: cleanDomain,
        },
      },
    });

    await this.prisma.integrationCredential.deleteMany({
      where: { integrationId: integration.id },
    });

    await this.prisma.integrationCredential.createMany({
      data: [
        {
          id: uuidv4(),
          integrationId: integration.id,
          credentialType: 'shop_domain',
          encryptedValue: this.encrypt(cleanDomain),
        },
        {
          id: uuidv4(),
          integrationId: integration.id,
          credentialType: 'access_token',
          encryptedValue: this.encrypt(dto.accessToken),
        },
      ],
    });

    return {
      connected: true,
      provider: 'shopify',
      shopDomain: cleanDomain,
    };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  async disconnect(@Req() req: any) {
    const integration = await this.prisma.integration.findUnique({
      where: {
        organizationId_provider: {
          organizationId: req.organizationId,
          provider: 'ecommerce',
        },
      },
    });

    if (integration) {
      await this.prisma.integration.delete({
        where: { id: integration.id },
      });
    }

    return { connected: false };
  }

  private encrypt(value: string): string {
    const key =
      process.env.ENCRYPTION_KEY || 'dev-only-key-change-in-production-32';
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(key.padEnd(32, '0').slice(0, 32)),
      iv,
    );
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf-8'),
      cipher.final(),
    ]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }
}
