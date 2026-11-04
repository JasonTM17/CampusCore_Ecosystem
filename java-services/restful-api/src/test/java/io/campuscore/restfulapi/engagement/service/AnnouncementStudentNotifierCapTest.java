package io.campuscore.restfulapi.engagement.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

/** Preview caps keep a whole code point and mark a cut preview as cut. */
class AnnouncementStudentNotifierCapTest {

    private static final String ELLIPSIS = "\u2026";

    @Test
    void valueUnderTheCapIsUnchanged() {
        assertEquals("Thông báo học phí", AnnouncementStudentNotifier.capCodePoints("Thông báo học phí", 160));
    }

    @Test
    void valueExactlyAtTheCapIsUnchanged() {
        String value = "ế".repeat(160);
        assertEquals(value, AnnouncementStudentNotifier.capCodePoints(value, 160));
    }

    @Test
    void overTheCapEndsAtTheLastWordBoundaryInsideTheFinalFifth() {
        // The space at index 150 sits inside the last 20% of a 160 cap.
        String value = "a".repeat(150) + " " + "b".repeat(40);
        assertEquals("a".repeat(150) + ELLIPSIS, AnnouncementStudentNotifier.capCodePoints(value, 160));
    }

    @Test
    void overTheCapWithoutAWordBoundaryCutsAtTheCapAndKeepsTheEllipsisInsideIt() {
        String capped = AnnouncementStudentNotifier.capCodePoints("a".repeat(200), 160);
        assertEquals("a".repeat(159) + ELLIPSIS, capped);
        assertEquals(160, capped.codePointCount(0, capped.length()));
    }

    @Test
    void wordBoundaryBeforeTheFinalFifthFallsBackToTheCap() {
        // The only space is at index 100, outside the 127..158 window of a 160 cap.
        String value = "a".repeat(100) + " " + "b".repeat(99);
        assertEquals("a".repeat(100) + " " + "b".repeat(58) + ELLIPSIS,
                AnnouncementStudentNotifier.capCodePoints(value, 160));
    }

    @Test
    void emojiAtTheCutIsKeptWhole() {
        String value = "a".repeat(158) + "😀" + "b".repeat(10);
        String capped = AnnouncementStudentNotifier.capCodePoints(value, 160);
        assertEquals("a".repeat(158) + "😀" + ELLIPSIS, capped);
        assertEquals(160, capped.codePointCount(0, capped.length()));
    }

    @Test
    void capNeverSplitsASurrogatePair() {
        String value = "a".repeat(159) + "😀" + "tail";
        String capped = AnnouncementStudentNotifier.capCodePoints(value, 160);
        assertEquals("a".repeat(159) + ELLIPSIS, capped);
        assertEquals(160, capped.codePointCount(0, capped.length()));
    }

    @Test
    void cutNeverEndsOnACombiningMark() {
        // Decomposed "ế" is a base letter plus a combining acute; a cut between
        // the two would leave the accent attached to the ellipsis.
        String value = "e\u0301".repeat(10);
        String capped = AnnouncementStudentNotifier.capCodePoints(value, 11);
        assertEquals("e\u0301".repeat(4) + "e" + ELLIPSIS, capped);
        assertEquals(10, capped.codePointCount(0, capped.length()));
    }

    @Test
    void emptyAndNullStayUnchanged() {
        assertEquals("", AnnouncementStudentNotifier.capCodePoints("", 160));
        assertNull(AnnouncementStudentNotifier.capCodePoints(null, 160));
    }
}
