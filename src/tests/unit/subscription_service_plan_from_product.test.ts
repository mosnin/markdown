import { describe, it, expect, afterEach } from "vitest";

import { planFromProductId } from "@/server/services/subscription_service";

/**
 * Unit tests for `planFromProductId` — the Creem product-id → billing-tier
 * mapping the checkout webhook uses so Business buyers aren't under-provisioned
 * as Pro (audit issue #3).
 */

const ORIGINAL_PRO = process.env.CREEM_PRO_PRODUCT_ID;
const ORIGINAL_BUSINESS = process.env.CREEM_BUSINESS_PRODUCT_ID;

afterEach(() => {
  process.env.CREEM_PRO_PRODUCT_ID = ORIGINAL_PRO;
  process.env.CREEM_BUSINESS_PRODUCT_ID = ORIGINAL_BUSINESS;
});

describe("planFromProductId", () => {
  it("maps the Business product id to the business tier", () => {
    process.env.CREEM_PRO_PRODUCT_ID = "prod_pro";
    process.env.CREEM_BUSINESS_PRODUCT_ID = "prod_business";
    expect(planFromProductId("prod_business")).toBe("business");
  });

  it("maps the Pro product id to the pro tier", () => {
    process.env.CREEM_PRO_PRODUCT_ID = "prod_pro";
    process.env.CREEM_BUSINESS_PRODUCT_ID = "prod_business";
    expect(planFromProductId("prod_pro")).toBe("pro");
  });

  it("defaults to pro for an unknown product id (indeterminate)", () => {
    process.env.CREEM_PRO_PRODUCT_ID = "prod_pro";
    process.env.CREEM_BUSINESS_PRODUCT_ID = "prod_business";
    expect(planFromProductId("prod_something_else")).toBe("pro");
  });

  it("defaults to pro when the product id is null or undefined", () => {
    process.env.CREEM_PRO_PRODUCT_ID = "prod_pro";
    process.env.CREEM_BUSINESS_PRODUCT_ID = "prod_business";
    expect(planFromProductId(null)).toBe("pro");
    expect(planFromProductId(undefined)).toBe("pro");
  });

  it("does not classify as business when the Business env var is unset", () => {
    delete process.env.CREEM_BUSINESS_PRODUCT_ID;
    process.env.CREEM_PRO_PRODUCT_ID = "prod_pro";
    // An empty/unset env var must not accidentally match a real product id.
    expect(planFromProductId("prod_business")).toBe("pro");
  });
});
