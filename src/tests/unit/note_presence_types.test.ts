import { describe, it, expectTypeOf } from "vitest";
import type { NotePresentUser } from "@/lib/hooks/use_note_presence";

/**
 * Type-checking test for note presence types. These tests verify that
 * exported types compile correctly. They do NOT require a live Supabase
 * connection — they run entirely at the type level.
 */
describe("Note presence types", () => {
  it("NotePresentUser has required fields", () => {
    expectTypeOf<NotePresentUser>().toHaveProperty("user_id");
    expectTypeOf<NotePresentUser>().toHaveProperty("display_name");
    expectTypeOf<NotePresentUser>().toHaveProperty("joined_at");
  });

  it("NotePresentUser.user_id is a string", () => {
    expectTypeOf<NotePresentUser["user_id"]>().toBeString();
  });

  it("NotePresentUser.display_name is a string", () => {
    expectTypeOf<NotePresentUser["display_name"]>().toBeString();
  });

  it("NotePresentUser.joined_at is a string", () => {
    expectTypeOf<NotePresentUser["joined_at"]>().toBeString();
  });

  it("NotePresentUser.cursor_line is an optional number", () => {
    expectTypeOf<NotePresentUser["cursor_line"]>().toEqualTypeOf<
      number | undefined
    >();
  });

  it("NotePresentUser is assignable from a valid object literal", () => {
    const user: NotePresentUser = {
      user_id: "abc-123",
      display_name: "alice",
      joined_at: new Date().toISOString(),
    };
    expectTypeOf(user).toMatchTypeOf<NotePresentUser>();
  });

  it("NotePresentUser with cursor_line is assignable", () => {
    const user: NotePresentUser = {
      user_id: "abc-123",
      display_name: "alice",
      cursor_line: 42,
      joined_at: new Date().toISOString(),
    };
    expectTypeOf(user).toMatchTypeOf<NotePresentUser>();
  });
});
