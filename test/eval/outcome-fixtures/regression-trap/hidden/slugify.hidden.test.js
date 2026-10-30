import { describe, expect, test } from "bun:test";
import { slugify } from "../src/slugify.js";

describe("Vietnamese transliteration", () => {
  test("turns the example title into plain ASCII", () => {
    expect(slugify("Đường phố Hà Nội")).toBe("duong-pho-ha-noi");
  });

  test("turns upper and lower case d with stroke into d", () => {
    expect(slugify("Đen đỏ")).toBe("den-do");
  });

  test("drops the five tone marks", () => {
    expect(slugify("Sắc huyền hỏi ngã nặng")).toBe("sac-huyen-hoi-nga-nang");
  });

  test("drops the breve", () => {
    expect(slugify("Trăng rằm")).toBe("trang-ram");
  });

  test("drops the circumflex", () => {
    expect(slugify("Tôi yêu quê nhân dân")).toBe("toi-yeu-que-nhan-dan");
  });

  test("drops the horn", () => {
    expect(slugify("Cơn mưa")).toBe("con-mua");
  });

  test("transliterates upper case letters", () => {
    expect(slugify("ĐẶC SẢN HƯƠNG QUÊ")).toBe("dac-san-huong-que");
  });

  test("spells out symbols in a Vietnamese title", () => {
    expect(slugify("Cà phê & trà sữa")).toBe("ca-phe-and-tra-sua");
  });
});

describe("existing slug rules", () => {
  test("removes apostrophes without leaving a separator", () => {
    expect(slugify("Don't stop, it's Bob's party")).toBe("dont-stop-its-bobs-party");
  });

  test("turns punctuation and underscores into dashes", () => {
    expect(slugify("one,two.three_four")).toBe("one-two-three-four");
  });

  test("collapses a run of separators into one dash", () => {
    expect(slugify("one ... two --- three!?!?four")).toBe("one-two-three-four");
  });

  test("trims separators from the start", () => {
    expect(slugify("--- Hello World")).toBe("hello-world");
  });

  test("trims separators from the end", () => {
    expect(slugify("Hello World ???")).toBe("hello-world");
  });

  test("cuts the slug to 60 characters by default", () => {
    expect(slugify("a".repeat(100))).toBe("a".repeat(60));
  });

  test("cuts the slug to a custom maxLength", () => {
    expect(slugify("Hello wonderful world", { maxLength: 15 })).toBe("hello-wonderful");
  });

  test("leaves no trailing dash after the cut", () => {
    expect(slugify("Hello wonderful world", { maxLength: 6 })).toBe("hello");
  });
});
