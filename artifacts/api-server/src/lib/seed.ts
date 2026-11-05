import { db, lawyers } from "@workspace/db";
import { logger } from "./logger";

/**
 * Explicit developer-run seed, never an automatic production bootstrap.
 * These are fictional examples, not licensed/verified practitioners.
 */
async function main() {
  const examples = [
    { id: "example-ananya", name: "Ananya Mehra", title: "Family & matrimonial matters", city: "New Delhi", experienceYears: 12, practiceAreas: ["Family & Divorce", "Civil Law"], languages: ["English", "Hindi"], fee: 899, online: true },
    { id: "example-arjun", name: "Arjun Deshmukh", title: "Property & civil disputes", city: "Mumbai", experienceYears: 15, practiceAreas: ["Property & Real Estate", "Civil Law"], languages: ["English", "Hindi", "Marathi"], fee: 1299, online: true },
    { id: "example-meera", name: "Meera Iyer", title: "Business, contracts & startups", city: "Bengaluru", experienceYears: 9, practiceAreas: ["Business & Corporate", "Employment"], languages: ["English", "Hindi", "Tamil"], fee: 999, online: true },
    { id: "example-rohan", name: "Rohan Khanna", title: "Criminal defence & bail matters", city: "Chandigarh", experienceYears: 18, practiceAreas: ["Criminal Law", "Cyber Law"], languages: ["English", "Hindi", "Punjabi"], fee: 1499, online: false },
    { id: "example-kavya", name: "Kavya Reddy", title: "Consumer & workplace rights", city: "Hyderabad", experienceYears: 7, practiceAreas: ["Consumer Rights", "Employment"], languages: ["English", "Telugu", "Hindi"], fee: 599, online: true },
    { id: "example-vikram", name: "Vikram Rao", title: "Civil litigation & property", city: "Pune", experienceYears: 11, practiceAreas: ["Civil Law", "Property & Real Estate"], languages: ["English", "Hindi", "Marathi"], fee: 799, online: false },
    { id: "example-sana", name: "Sana Ali", title: "Family law & consumer protection", city: "Lucknow", experienceYears: 8, practiceAreas: ["Family & Divorce", "Consumer Rights"], languages: ["Hindi", "English", "Urdu"], fee: 699, online: true },
    { id: "example-dev", name: "Dev Menon", title: "Digital rights & business contracts", city: "Chennai", experienceYears: 10, practiceAreas: ["Cyber Law", "Business & Corporate"], languages: ["English", "Tamil", "Malayalam"], fee: 1099, online: false },
  ];
  await db.insert(lawyers).values(examples.map((example, index) => ({
    ...example,
    bio: "Illustrative profile for exploring this separate pilot. This is not a real practitioner listing, and requesting a slot will not connect you to a lawyer. Real advocates can apply through the professional profile page and are published only after the platform reviews their application.",
    demo: true, verified: false, approvalStatus: "approved" as const,
    barCouncil: "Illustrative — not a registered practitioner",
    enrollmentNumber: `EXAMPLE-ONLY-${index + 1}`,
    availability: [1, 2, 3, 4, 5, 6],
  }))).onConflictDoNothing();
}
main().then(() => {
  logger.info("Illustrative marketplace profiles are ready.");
  process.exit(0);
}).catch((err: Error) => {
  logger.error({ name: err.name }, "Could not seed illustrative profiles");
  process.exit(1);
});
