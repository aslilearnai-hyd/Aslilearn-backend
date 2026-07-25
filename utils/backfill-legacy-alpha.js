/**
 * One-time / idempotent backfill: untagged IIT content → ALPHA.
 * Safe to call on every startup — only updates empty/missing productCategory.
 */
import AiToolGeneration from '../models/AiToolGeneration.js';
import AiToolTopic from '../models/AiToolTopic.js';
import Book from '../models/Book.js';
import Content from '../models/Content.js';

const IIT_BOARD_REGEX = /IIT|NEET|JEE/i;

const EMPTY_CATEGORY = {
  $or: [
    { productCategory: { $exists: false } },
    { productCategory: null },
    { productCategory: '' },
  ],
};

let ranThisProcess = false;

/**
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{ skipped?: boolean, generations: number, topics: number, books: number, contents: number }>}
 */
export async function backfillLegacyIitContentToAlpha(opts = {}) {
  if (ranThisProcess && !opts.force) {
    return { skipped: true, generations: 0, topics: 0, books: 0, contents: 0 };
  }
  ranThisProcess = true;

  const withIitBoard = () => ({
    $and: [{ board: IIT_BOARD_REGEX }, EMPTY_CATEGORY],
  });

  const [genResult, topicResult, bookResult, contentResult] = await Promise.all([
    AiToolGeneration.updateMany(withIitBoard(), {
      $set: { productCategory: 'ALPHA' },
    }),
    AiToolTopic.updateMany(withIitBoard(), {
      $set: { productCategory: 'ALPHA' },
    }),
    Book.updateMany(withIitBoard(), {
      $set: { productCategory: 'ALPHA' },
    }),
    Content.updateMany(withIitBoard(), {
      $set: { productCategory: 'ALPHA' },
    }),
  ]);

  const generations = Number(genResult?.modifiedCount || 0);
  const topics = Number(topicResult?.modifiedCount || 0);
  const books = Number(bookResult?.modifiedCount || 0);
  const contents = Number(contentResult?.modifiedCount || 0);

  if (generations || topics || books || contents) {
    console.log(
      `[backfill] Legacy IIT → ALPHA: ${generations} generation(s), ${topics} topic(s), ${books} book(s), ${contents} content(s)`,
    );
  }

  return { generations, topics, books, contents };
}
