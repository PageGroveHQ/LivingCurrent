export type DailyQuoteSet = {
  scripture: { text: string; source: string };
  motivation: { text: string; source: string };
  financial: { text: string; source: string };
};

// Kept in the app so the loading screen never depends on an outside quote API.
// One complete set is selected from the local calendar date and remains stable all day.
export const dailyQuoteSets: DailyQuoteSet[] = [
  {
    scripture: { text: "Commit thy works unto the Lord, and thy thoughts shall be established.", source: "Proverbs 16:3 · KJV" },
    motivation: { text: "Great things are done by a series of small things brought together.", source: "Vincent van Gogh" },
    financial: { text: "An investment in knowledge pays the best interest.", source: "Benjamin Franklin" },
  },
  {
    scripture: { text: "Let all things be done decently and in order.", source: "1 Corinthians 14:40 · KJV" },
    motivation: { text: "The secret of getting ahead is getting started.", source: "Mark Twain" },
    financial: { text: "Beware of little expenses; a small leak will sink a great ship.", source: "Benjamin Franklin" },
  },
  {
    scripture: { text: "The thoughts of the diligent tend only to plenteousness.", source: "Proverbs 21:5 · KJV" },
    motivation: { text: "Success is the sum of small efforts, repeated day in and day out.", source: "Robert Collier" },
    financial: { text: "Do not save what is left after spending, but spend what is left after saving.", source: "Warren Buffett" },
  },
  {
    scripture: { text: "For where your treasure is, there will your heart be also.", source: "Matthew 6:21 · KJV" },
    motivation: { text: "Well done is better than well said.", source: "Benjamin Franklin" },
    financial: { text: "Never spend your money before you have it.", source: "Thomas Jefferson" },
  },
  {
    scripture: { text: "He that is faithful in that which is least is faithful also in much.", source: "Luke 16:10 · KJV" },
    motivation: { text: "The future depends on what you do today.", source: "Mahatma Gandhi" },
    financial: { text: "A budget is telling your money where to go instead of wondering where it went.", source: "Dave Ramsey" },
  },
  {
    scripture: { text: "Two are better than one; because they have a good reward for their labour.", source: "Ecclesiastes 4:9 · KJV" },
    motivation: { text: "Act as if what you do makes a difference. It does.", source: "William James" },
    financial: { text: "The art is not in making money, but in keeping it.", source: "Proverb" },
  },
  {
    scripture: { text: "But godliness with contentment is great gain.", source: "1 Timothy 6:6 · KJV" },
    motivation: { text: "It always seems impossible until it’s done.", source: "Nelson Mandela" },
    financial: { text: "Know what you own, and know why you own it.", source: "Peter Lynch" },
  },
];

export function getDailyQuoteSet(date = new Date()): DailyQuoteSet {
  const localDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNumber = Math.floor(localDay.getTime() / 86_400_000);
  return dailyQuoteSets[((dayNumber % dailyQuoteSets.length) + dailyQuoteSets.length) % dailyQuoteSets.length];
}
