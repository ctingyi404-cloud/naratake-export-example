/* How many entries make a page.

   The number had three homes: the list block's own PAGE_SIZE, the entry page's
   ARCHIVE_PAGE, and an implicit assumption in the server's first-page read. The
   third one disagreed with the other two — "show every entry" reaches the server
   as limit 0, which it clamped to 1, so a full archive rendered a single story
   and the pager underneath it counted pages of twenty-four. */
export const LIST_PAGE = 24;

/** The rows to take for a list block. 0 or less means "all of them, a page at a
    time", which is the block's own documented meaning of Max entries = 0. */
export const pageSize = (limit: number) => (limit > 0 ? Math.min(60, limit) : LIST_PAGE);
