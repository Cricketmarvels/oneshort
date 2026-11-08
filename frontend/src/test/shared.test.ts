import { formatPaise, normaliseMobile, rupeesToPaise, parseRosterText, parseStatsText, whatsappLink } from "@cm/shared";

describe("money helpers (integer paise)", () => {
  it("formats paise as rupees", () => {
    expect(formatPaise(40000)).toBe("₹400");
    expect(formatPaise(33334)).toBe("₹333.34");
    expect(formatPaise(12345600)).toBe("₹1,23,456");
    expect(formatPaise(5)).toBe("₹0.05");
  });
  it("parses rupee input without floating point drift", () => {
    expect(rupeesToPaise("0.29")).toBe(29);
    expect(rupeesToPaise("4,000")).toBe(400000);
    expect(rupeesToPaise("₹ 12.5")).toBe(1250);
    expect(Number.isNaN(rupeesToPaise("12.345"))).toBe(true);
    expect(Number.isNaN(rupeesToPaise("abc"))).toBe(true);
  });
});

describe("misc", () => {
  it("normalises Indian mobile numbers", () => {
    expect(normaliseMobile("98765 43210")).toBe("+919876543210");
    expect(normaliseMobile("+14155550100")).toBe("+14155550100");
  });
  it("builds WhatsApp links with encoded text", () => {
    expect(whatsappLink("Pay ₹400 & join", "+919876543210")).toBe("https://wa.me/919876543210?text=Pay%20%E2%82%B9400%20%26%20join");
  });
});

describe("CricHeroes manual entry parsers", () => {
  it("parses roster lines with optional roles", () => {
    expect(parseRosterText("Aman Verma - Batsman\n\n  Ravi Chauhan, Bowler \nSolo\nK. L. Sharma | Wicketkeeper")).toEqual([
      { name: "Aman Verma", sub_title: "Batsman" },
      { name: "Ravi Chauhan", sub_title: "Bowler" },
      { name: "Solo" },
      { name: "K. L. Sharma", sub_title: "Wicketkeeper" },
    ]);
    expect(parseRosterText("Jean-Paul Singh")).toEqual([{ name: "Jean-Paul Singh" }]); // hyphen without spaces is part of the name
  });
  it("parses stat lines and skips malformed ones", () => {
    expect(parseStatsText("Matches: 42\nWin %: 61%\nno colon here\n: missing label")).toEqual([
      { label: "Matches", value: "42" },
      { label: "Win %", value: "61%" },
    ]);
  });
});
