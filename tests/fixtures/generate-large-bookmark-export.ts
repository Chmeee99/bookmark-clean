const FOLDER_COUNT = 100;
const BOOKMARKS_PER_FOLDER = 99;
const BOOKMARK_COUNT = 9_900 as const;
const NODE_COUNT = 10_000 as const;
const BASE_EPOCH_SECONDS = 1_700_000_000;
const FOLDER_DATE_STEP_SECONDS = 1_000;
const BOOKMARK_DATE_OFFSET_SECONDS = 200_000;
const BOOKMARK_DATE_STEP_SECONDS = 2;

export interface LargeBookmarkSample {
  readonly folderIndex: number;
  readonly bookmarkIndex: number;
  readonly folder: {
    readonly kind: "folder";
    readonly sourceId: string;
    readonly title: string;
    readonly dateAdded: string;
    readonly dateModified: string;
    readonly childCount: number;
  };
  readonly bookmark: {
    readonly kind: "bookmark";
    readonly sourceId: string;
    readonly title: string;
    readonly url: string;
    readonly dateAdded: string;
    readonly dateModified: string;
    readonly dateLastUsed: string;
  };
}

export interface LargeBookmarkExport {
  readonly html: string;
  readonly rootCount: 100;
  readonly folderCount: 100;
  readonly bookmarkCount: 9900;
  readonly nodeCount: 10000;
  readonly expectedSamples: {
    readonly beginning: LargeBookmarkSample;
    readonly middle: LargeBookmarkSample;
    readonly end: LargeBookmarkSample;
  };
}

function indexLabel(index: number): string {
  return String(index).padStart(3, "0");
}

function folderTitle(folderIndex: number): string {
  return `Folder ${indexLabel(folderIndex)}`;
}

function bookmarkTitle(folderIndex: number, bookmarkIndex: number): string {
  return `Bookmark ${indexLabel(folderIndex)}-${indexLabel(bookmarkIndex)}`;
}

function bookmarkUrl(folderIndex: number, bookmarkIndex: number): string {
  return `https://example.com/folder-${indexLabel(folderIndex)}/bookmark-${indexLabel(bookmarkIndex)}`;
}

function isoFromEpochSeconds(seconds: number): string {
  return new Date(seconds * 1_000).toISOString();
}

function folderDateAdded(folderIndex: number): number {
  return BASE_EPOCH_SECONDS + folderIndex * FOLDER_DATE_STEP_SECONDS;
}

function folderDateModified(folderIndex: number): number {
  return folderDateAdded(folderIndex) + 1;
}

function bookmarkDateAdded(folderIndex: number, bookmarkIndex: number): number {
  return (
    BASE_EPOCH_SECONDS +
    BOOKMARK_DATE_OFFSET_SECONDS +
    folderIndex * FOLDER_DATE_STEP_SECONDS +
    bookmarkIndex * BOOKMARK_DATE_STEP_SECONDS
  );
}

function bookmarkDateModified(folderIndex: number, bookmarkIndex: number): number {
  return bookmarkDateAdded(folderIndex, bookmarkIndex) + 1;
}

function bookmarkDateLastUsed(folderIndex: number, bookmarkIndex: number): number {
  return bookmarkDateAdded(folderIndex, bookmarkIndex) + 2;
}

function expectedSample(folderIndex: number, bookmarkIndex: number): LargeBookmarkSample {
  return {
    folderIndex,
    bookmarkIndex,
    folder: {
      kind: "folder",
      sourceId: `html:${folderIndex}`,
      title: folderTitle(folderIndex),
      dateAdded: isoFromEpochSeconds(folderDateAdded(folderIndex)),
      dateModified: isoFromEpochSeconds(folderDateModified(folderIndex)),
      childCount: BOOKMARKS_PER_FOLDER,
    },
    bookmark: {
      kind: "bookmark",
      sourceId: `html:${folderIndex}/${bookmarkIndex}`,
      title: bookmarkTitle(folderIndex, bookmarkIndex),
      url: bookmarkUrl(folderIndex, bookmarkIndex),
      dateAdded: isoFromEpochSeconds(bookmarkDateAdded(folderIndex, bookmarkIndex)),
      dateModified: isoFromEpochSeconds(bookmarkDateModified(folderIndex, bookmarkIndex)),
      dateLastUsed: isoFromEpochSeconds(bookmarkDateLastUsed(folderIndex, bookmarkIndex)),
    },
  };
}

function generateHtml(): string {
  const chunks = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL>",
  ];

  for (let folderIndex = 0; folderIndex < FOLDER_COUNT; folderIndex += 1) {
    chunks.push(
      `<DT><H3 ADD_DATE="${folderDateAdded(folderIndex)}" LAST_MODIFIED="${folderDateModified(folderIndex)}">${folderTitle(folderIndex)}</H3></DT>`,
      "<DL>",
    );
    for (
      let bookmarkIndex = 0;
      bookmarkIndex < BOOKMARKS_PER_FOLDER;
      bookmarkIndex += 1
    ) {
      chunks.push(
        `<DT><A HREF="${bookmarkUrl(folderIndex, bookmarkIndex)}" ADD_DATE="${bookmarkDateAdded(folderIndex, bookmarkIndex)}" LAST_MODIFIED="${bookmarkDateModified(folderIndex, bookmarkIndex)}" LAST_VISIT="${bookmarkDateLastUsed(folderIndex, bookmarkIndex)}">${bookmarkTitle(folderIndex, bookmarkIndex)}</A></DT>`,
      );
    }
    chunks.push("</DL>");
  }

  chunks.push("</DL>");
  return chunks.join("");
}

function generateLargeBookmarkExport(): LargeBookmarkExport {
  return {
    html: generateHtml(),
    rootCount: FOLDER_COUNT,
    folderCount: FOLDER_COUNT,
    bookmarkCount: BOOKMARK_COUNT,
    nodeCount: NODE_COUNT,
    expectedSamples: {
      beginning: expectedSample(0, 0),
      middle: expectedSample(50, 49),
      end: expectedSample(99, 98),
    },
  };
}

declare const module: {
  exports: {
    generateLargeBookmarkExport: typeof generateLargeBookmarkExport;
  };
};

module.exports = { generateLargeBookmarkExport };
