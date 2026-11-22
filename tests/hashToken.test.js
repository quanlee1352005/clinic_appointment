// Unit test cho hàm hashToken() trong server/auth.js
// Công cụ: Vitest
//
import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import { describe, it, expect } from "vitest";
import { hashToken } from "../server/auth.js";

// Hàm tham chiếu độc lập dùng để đối chiếu kết quả
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

describe("hashToken() - băm token phiên đăng nhập bằng SHA-256", () => {
  // ---------- Nhóm 1: kết quả đúng ----------
  it("TC01: token 'abc' trả về đúng vector chuẩn SHA-256", () => {
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("TC02: chuỗi rỗng trả về đúng vector chuẩn SHA-256 của chuỗi rỗng", () => {
    expect(hashToken("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("TC03: token ngẫu nhiên như lúc tạo phiên (base64url) khớp hàm tham chiếu", () => {
    const token = randomBytes(32).toString("base64url");
    expect(hashToken(token)).toBe(sha256(token));
  });

  it("TC04: token có ký tự Unicode (tiếng Việt) vẫn băm đúng", () => {
    const token = "Phiên đăng nhập - Lê Anh Quân";
    expect(hashToken(token)).toBe(sha256(token));
  });

  // ---------- Nhóm 2: định dạng đầu ra ----------
  it("TC05: kết quả luôn gồm 64 ký tự hex viết thường", () => {
    for (const token of ["a", "abc", "x".repeat(100), randomBytes(32).toString("base64url")]) {
      expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("TC06: kết quả không chứa token gốc (không lộ token)", () => {
    const token = "my-secret-session-token";
    expect(hashToken(token)).not.toContain(token);
  });

  // ---------- Nhóm 3: tính chất của hàm băm ----------
  it("TC07: cùng một token luôn cho cùng một hash (tất định)", () => {
    expect(hashToken("token-1")).toBe(hashToken("token-1"));
  });

  it("TC08: hai token khác nhau cho hai hash khác nhau", () => {
    expect(hashToken("token-1")).not.toBe(hashToken("token-2"));
  });

  it("TC09: phân biệt chữ hoa và chữ thường", () => {
    expect(hashToken("abc")).not.toBe(hashToken("ABC"));
  });

  it("TC10: chỉ khác nhau một ký tự (khoảng trắng cuối) vẫn ra hash khác", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abc "));
  });

  // ---------- Nhóm 4: đầu vào sai ----------
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["số", 12345],
    ["object", {}],
  ])("TC11: đầu vào không phải chuỗi (%s) ném lỗi", (_ten, giaTri) => {
    expect(() => hashToken(giaTri)).toThrow();
  });
});
