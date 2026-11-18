import { matchPerson, parseDuesList } from "../lib/duesList";

const LIST = `Pending Match Fees to be paid at:

shubhang.dixit@ybl




2. Ajay Sinha - 600
3. @Ayush Boss -  950
4. Shashank - 1360
5. mohitbirbalgaur - 588 + 500 = 1088
6. sanjuyaduvanshi 258 - 475
7. Prashant Jha - 542 + 500 = 1042
8. Arun - 500
9. Ankit Mishra - 489
10. Abhishek Tyagi - 577 (advance)
11. Apoorv Shonik - 500`;

test("reads the owner's WhatsApp list: UPI, names, totals and the advance", () => {
  const { upi, rows } = parseDuesList(LIST);
  expect(upi).toBe("shubhang.dixit@ybl");
  expect(rows.map((r) => [r.name, r.amountPaise / 100])).toEqual([
    ["Ajay Sinha", 600], ["Ayush Boss", 950], ["Shashank", 1360], ["mohitbirbalgaur", 1088], ["sanjuyaduvanshi", -217],
    ["Prashant Jha", 1042], ["Arun", 500], ["Ankit Mishra", 489], ["Abhishek Tyagi", -577], ["Apoorv Shonik", 500],
  ]);
  expect(rows.find((r) => r.name === "Abhishek Tyagi")!.note).toBe("Advance");
  expect(rows.find((r) => r.name === "sanjuyaduvanshi")!.check).toBe(true); // "258 - 475" needs a human look
  expect(rows.find((r) => r.name === "mohitbirbalgaur")!.check).toBe(false);
});

test("matches pasted names to the people in the split", () => {
  const people = [
    { key: "1", name: "Mohit Birbal Gaur" }, { key: "2", name: "Ajay Sinha" }, { key: "3", name: "Arun Kumar" },
    { key: "4", name: "Ankit Mishra" }, { key: "5", name: "Ankit Sharma" },
  ];
  expect(matchPerson("mohitbirbalgaur", people)).toBe("1");
  expect(matchPerson("Ajay Sinha", people)).toBe("2");
  expect(matchPerson("Arun", people)).toBe("3");
  expect(matchPerson("Ankit Mishra", people)).toBe("4");
  expect(matchPerson("Ankit", people)).toBeNull(); // two Ankits: ask the captain
  expect(matchPerson("Shashank", people)).toBeNull();
});
