// Categories this person picked most recently, per book, so the picker can show them first.
// A per-device convenience: losing it only resets the order.

const key = (bookId: string) => `ffos.recentCategories.${bookId}`;

export function recentCategoryIds(bookId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key(bookId)) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function rememberCategory(bookId: string, categoryId: string) {
  try {
    const next = [categoryId, ...recentCategoryIds(bookId).filter((id) => id !== categoryId)].slice(0, 20);
    localStorage.setItem(key(bookId), JSON.stringify(next));
  } catch {
    // Storage unavailable: order just isn't remembered.
  }
}
