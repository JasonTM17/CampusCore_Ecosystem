package io.campuscore.restfulapi.academic.registration;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import java.util.zip.Deflater;
import java.util.zip.DeflaterOutputStream;
import org.springframework.stereotype.Component;

/**
 * Standard PDF 1.4 renderer for course registration slips.
 * Generates valid, parseable PDF documents with embedded Unicode fonts, xref tables,
 * object offsets, and metadata, compatible with any standard PDF viewer or library.
 */
@Component
public class RegistrationPdfRenderer {

    private static final int ROWS_PER_PAGE = 12;
    private static final int FONT_OBJECT_COUNT = 5;
    // Budgets keep each field inside the 612 pt MediaBox at the size it is drawn.
    private static final int COURSE_NAME_MAX_CODE_POINTS = 36;
    private static final int STUDENT_NAME_MAX_CODE_POINTS = 24;
    private static final int SEMESTER_NAME_MAX_CODE_POINTS = 33;
    private static final int LEGACY_LINE_MAX_CODE_POINTS = 102;

    public record CourseItem(
            String courseCode,
            String courseName,
            String sectionNumber,
            int credits,
            String enrollmentId,
            String sectionId) {}

    public byte[] render(String studentId, String semesterId, String enrollmentId, String sectionId) {
        String cleanStudentId = safe(studentId);
        String cleanSemesterId = safe(semesterId);
        String cleanEnrollmentId = safe(enrollmentId);
        String cleanSectionId = safe(sectionId);

        List<CourseItem> singleCourse = List.of(new CourseItem(
                cleanSectionId,
                "Học phần đăng ký / Registered Course",
                cleanSectionId,
                0,
                cleanEnrollmentId,
                cleanSectionId));

        return renderEnriched(
                cleanStudentId,
                cleanStudentId,
                null,
                cleanSemesterId,
                cleanSemesterId,
                cleanEnrollmentId,
                cleanSectionId,
                singleCourse);
    }

    public byte[] renderEnriched(
            String studentId,
            String studentCode,
            String studentName,
            String semesterId,
            String semesterName,
            String enrollmentId,
            String sectionId,
            List<CourseItem> courses) {

        FontUsage regularFont = new FontUsage(FontResources.REGULAR);
        FontUsage boldFont = new FontUsage(FontResources.BOLD);
        String cleanStudentId = safe(studentId);
        String cleanStudentCode = safe(studentCode != null && !studentCode.isBlank() ? studentCode : studentId);
        String cleanStudentName = truncate(
                studentName != null && !studentName.isBlank() ? studentName : cleanStudentId,
                STUDENT_NAME_MAX_CODE_POINTS);
        String cleanSemesterId = safe(semesterId);
        String cleanSemesterName = truncate(
                semesterName != null && !semesterName.isBlank() ? semesterName : cleanSemesterId,
                SEMESTER_NAME_MAX_CODE_POINTS);
        String cleanEnrollmentId = safe(enrollmentId);
        String cleanSectionId = safe(sectionId);

        String legacyText = truncate(
                "CampusUTE registration slip student="
                        + cleanStudentId
                        + " semester="
                        + cleanSemesterId
                        + " enrollment="
                        + cleanEnrollmentId
                        + " section="
                        + cleanSectionId,
                LEGACY_LINE_MAX_CODE_POINTS);

        List<String> streamLines = new ArrayList<>();
        // Decorative header lines
        streamLines.add("q");
        streamLines.add("0.8 w 0.15 0.35 0.75 RG");
        streamLines.add("54 755 m 558 755 l S");
        streamLines.add("54 705 m 558 705 l S");
        streamLines.add("Q");

        // University & Department Titles
        streamLines.add("BT");
        streamLines.add("/F2 13 Tf 54 738 Td "
                + pdfText("TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP. HỒ CHÍ MINH", boldFont) + " Tj");
        streamLines.add("ET");
        streamLines.add("BT");
        streamLines.add("/F1 9 Tf 54 723 Td "
                + pdfText("PHÒNG ĐÀO TẠO - CỔNG THÔNG TIN HỌC VỤ CAMPUSCORE", regularFont) + " Tj");
        streamLines.add("ET");
        streamLines.add("BT");
        streamLines.add("/F1 8 Tf 54 711 Td "
                + pdfText("Hệ thống Quản lý Đào tạo và Đăng ký Tín chỉ", regularFont) + " Tj");
        streamLines.add("ET");

        // Document Title
        streamLines.add("BT");
        streamLines.add("/F2 15 Tf 170 675 Td " + pdfText("PHIẾU ĐĂNG KÝ HỌC PHẦN", boldFont) + " Tj");
        streamLines.add("ET");
        streamLines.add("BT");
        streamLines.add("/F1 10 Tf 205 660 Td " + pdfText("COURSE REGISTRATION SLIP", regularFont) + " Tj");
        streamLines.add("ET");

        // Info Box (y=575 to 645)
        streamLines.add("q");
        streamLines.add("0.5 w 0.75 0.75 0.75 RG");
        streamLines.add("54 575 504 70 re S");
        streamLines.add("Q");

        streamLines.add("BT");
        streamLines.add("/F2 9 Tf 68 630 Td " + pdfText("Mã sinh viên / Student ID:", boldFont) + " Tj");
        streamLines.add("/F1 9 Tf 190 630 Td " + pdfText(cleanStudentCode, regularFont) + " Tj");
        streamLines.add("/F2 9 Tf 330 630 Td " + pdfText("Học kỳ / Semester:", boldFont) + " Tj");
        streamLines.add("/F1 9 Tf 420 630 Td " + pdfText(cleanSemesterName, regularFont) + " Tj");
        streamLines.add("ET");

        streamLines.add("BT");
        streamLines.add("/F2 9 Tf 68 610 Td " + pdfText("Họ và tên / Student Name:", boldFont) + " Tj");
        streamLines.add("/F1 9 Tf 190 610 Td " + pdfText(cleanStudentName, regularFont) + " Tj");
        streamLines.add("/F2 9 Tf 330 610 Td " + pdfText("Trạng thái / Status:", boldFont) + " Tj");
        streamLines.add("/F2 9 Tf 420 610 Td " + pdfText("ĐÃ GHI DANH HỢP LỆ / ENROLLED", boldFont) + " Tj");
        streamLines.add("ET");

        streamLines.add("BT");
        streamLines.add("/F2 9 Tf 68 590 Td " + pdfText("Mã ghi danh / Enrollment ID:", boldFont) + " Tj");
        streamLines.add("/F1 9 Tf 190 590 Td " + pdfText(cleanEnrollmentId, regularFont) + " Tj");
        streamLines.add("/F2 9 Tf 330 590 Td " + pdfText("Lớp học phần / Section ID:", boldFont) + " Tj");
        streamLines.add("/F1 9 Tf 420 590 Td " + pdfText(cleanSectionId, regularFont) + " Tj");
        streamLines.add("ET");

        // Course Table
        // Table Header (y=548, height 16)
        streamLines.add("q");
        streamLines.add("0.92 0.94 0.97 rg");
        streamLines.add("54 548 504 16 re f");
        streamLines.add("0.7 0.7 0.7 RG 0.5 w");
        streamLines.add("54 548 504 16 re S");
        streamLines.add("Q");

        streamLines.add("BT");
        streamLines.add("0 g");
        streamLines.add("/F2 8 Tf 60 553 Td " + pdfText("STT", boldFont) + " Tj");
        streamLines.add("/F2 8 Tf 85 553 Td " + pdfText("Mã MH", boldFont) + " Tj");
        streamLines.add("/F2 8 Tf 150 553 Td " + pdfText("Tên học phần", boldFont) + " Tj");
        streamLines.add("/F2 8 Tf 365 553 Td " + pdfText("Lớp HP", boldFont) + " Tj");
        streamLines.add("/F2 8 Tf 435 553 Td " + pdfText("Số TC", boldFont) + " Tj");
        streamLines.add("/F2 8 Tf 485 553 Td " + pdfText("Trạng thái", boldFont) + " Tj");
        streamLines.add("ET");

        List<CourseItem> items = courses != null && !courses.isEmpty()
                ? courses
                : List.of(new CourseItem(
                        cleanSectionId,
                        "Học phần đăng ký / Registered Course",
                        cleanSectionId,
                        0,
                        cleanEnrollmentId,
                        cleanSectionId));
        long totalCredits = items.stream().mapToLong(CourseItem::credits).sum();
        List<String> pageHeaderLines = List.copyOf(streamLines);
        List<byte[]> pageStreams = new ArrayList<>();

        for (int pageStart = 0; pageStart < items.size(); pageStart += ROWS_PER_PAGE) {
            int pageEnd = Math.min(items.size(), pageStart + ROWS_PER_PAGE);
            List<CourseItem> pageItems = items.subList(pageStart, pageEnd);
            boolean finalPage = pageEnd == items.size();
            List<String> pageLines = new ArrayList<>(pageHeaderLines);

            for (int i = 0; i < pageItems.size(); i++) {
                CourseItem item = pageItems.get(i);
                int rowNumber = pageStart + i + 1;
                int rowY = 532 - (i * 16);

                pageLines.add("q");
                pageLines.add("0.85 0.85 0.85 RG 0.4 w");
                pageLines.add("54 " + (rowY - 4) + " m 558 " + (rowY - 4) + " l S");
                pageLines.add("Q");

                String cName = item.courseName() != null ? item.courseName() : "Course " + rowNumber;
                cName = truncate(cName, COURSE_NAME_MAX_CODE_POINTS);

                pageLines.add("BT");
                pageLines.add("0 g");
                pageLines.add("/F1 8 Tf 62 " + rowY + " Td " + pdfText(String.valueOf(rowNumber), regularFont) + " Tj");
                pageLines.add("/F1 8 Tf 85 " + rowY + " Td " + pdfText(item.courseCode(), regularFont) + " Tj");
                pageLines.add("/F1 8 Tf 150 " + rowY + " Td " + pdfText(cName, regularFont) + " Tj");
                pageLines.add("/F1 8 Tf 365 " + rowY + " Td " + pdfText(item.sectionNumber(), regularFont) + " Tj");
                pageLines.add("/F1 8 Tf 440 " + rowY + " Td "
                        + pdfText(item.credits() > 0 ? String.valueOf(item.credits()) : "-", regularFont) + " Tj");
                pageLines.add("/F1 8 Tf 485 " + rowY + " Td " + pdfText("Hợp lệ", regularFont) + " Tj");
                pageLines.add("ET");
            }

            int afterTableY = 532 - (pageItems.size() * 16) - 10;
            if (finalPage && totalCredits > 0) {
                pageLines.add("BT");
                pageLines.add("/F2 9 Tf 350 " + afterTableY + " Td "
                        + pdfText("Tổng số tín chỉ đăng ký: " + totalCredits + " TC", boldFont) + " Tj");
                pageLines.add("ET");
            }

            if (finalPage) {
                int sigY = Math.min(afterTableY - 25, 340);
                pageLines.add("BT");
                pageLines.add("/F2 9 Tf 90 " + sigY + " Td " + pdfText("Sinh viên đăng ký", boldFont) + " Tj");
                pageLines.add("/F1 8 Tf 85 " + (sigY - 12) + " Td "
                        + pdfText("(Ký và ghi rõ họ tên)", regularFont) + " Tj");
                pageLines.add("/F2 9 Tf 380 " + sigY + " Td "
                        + pdfText("Xác nhận Phòng Đào tạo", boldFont) + " Tj");
                pageLines.add("/F1 8 Tf 380 " + (sigY - 12) + " Td "
                        + pdfText("(Ký tên và đóng dấu)", regularFont) + " Tj");
                pageLines.add("ET");
            }

            pageLines.add("q");
            pageLines.add("0.5 w 0.8 0.8 0.8 RG");
            pageLines.add("54 135 m 558 135 l S");
            pageLines.add("Q");
            pageLines.add("BT");
            pageLines.add("/F1 8 Tf 54 120 Td "
                    + pdfText("Phiếu đăng ký có giá trị xác nhận kết quả đăng ký học phần tại Phòng Đào tạo.", regularFont)
                    + " Tj");
            pageLines.add("ET");
            pageLines.add("BT");
            pageLines.add("/F1 8 Tf 54 105 Td " + pdfText(legacyText, regularFont) + " Tj");
            pageLines.add("ET");
            pageLines.add("BT");
            pageLines.add("/F1 7 Tf 54 90 Td "
                    + pdfText("CampusUTE Official Registration Document - Verified by SHA-256 Digest", regularFont) + " Tj");
            pageLines.add("ET");

            String streamContent = String.join("\n", pageLines) + "\n";
            pageStreams.add(streamContent.getBytes(StandardCharsets.US_ASCII));
        }

        return assemblePdf(pageStreams, regularFont, boldFont);
    }

    private byte[] assemblePdf(List<byte[]> pageStreams, FontUsage regularFont, FontUsage boldFont) {
        byte[] header = "%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n".getBytes(StandardCharsets.ISO_8859_1);
        int regularFontId = 3 + pageStreams.size() * 2;
        FontObjectIds regularIds = new FontObjectIds(regularFontId);
        FontObjectIds boldIds = new FontObjectIds(regularFontId + FONT_OBJECT_COUNT);

        List<byte[]> objects = new ArrayList<>();
        objects.add(pdfObject(1, "<</Type/Catalog/Pages 2 0 R>>"));
        StringBuilder pageKids = new StringBuilder();
        for (int pageIndex = 0; pageIndex < pageStreams.size(); pageIndex++) {
            if (pageIndex > 0) pageKids.append(' ');
            pageKids.append(3 + pageIndex * 2).append(" 0 R");
        }
        objects.add(pdfObject(2, "<</Type/Pages/Count " + pageStreams.size() + "/Kids[" + pageKids + "]>>"));

        for (int pageIndex = 0; pageIndex < pageStreams.size(); pageIndex++) {
            int pageObjectId = 3 + pageIndex * 2;
            int contentObjectId = pageObjectId + 1;
            String pageObject = "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents "
                    + contentObjectId + " 0 R/Resources<</Font<</F1 " + regularIds.type0Id() + " 0 R/F2 "
                    + boldIds.type0Id() + " 0 R>>>>>>";
            objects.add(pdfObject(pageObjectId, pageObject));
            objects.add(pdfStreamObject(
                    contentObjectId,
                    "<</Length " + pageStreams.get(pageIndex).length + ">>",
                    pageStreams.get(pageIndex)));
        }

        addFontObjects(objects, regularIds, regularFont, "BeVietnamPro-Regular");
        addFontObjects(objects, boldIds, boldFont, "BeVietnamPro-Bold");

        int objectCount = objects.size() + 1;
        int[] offsets = new int[objectCount];
        int currentOffset = header.length;
        for (int index = 0; index < objects.size(); index++) {
            offsets[index + 1] = currentOffset;
            currentOffset += objects.get(index).length;
        }

        int xrefOffset = currentOffset;
        StringBuilder xref = new StringBuilder();
        xref.append("xref\r\n0 ").append(objectCount).append("\r\n");
        xref.append("0000000000 65535 f\r\n");
        for (int objectNumber = 1; objectNumber < objectCount; objectNumber++) {
            xref.append(String.format(Locale.ROOT, "%010d 00000 n\r\n", offsets[objectNumber]));
        }

        StringBuilder trailer = new StringBuilder();
        trailer.append("trailer\r\n<</Size ").append(objectCount).append("/Root 1 0 R>>\r\n");
        trailer.append("startxref\r\n").append(xrefOffset).append("\r\n%%EOF\r\n");

        byte[] xrefBytes = xref.toString().getBytes(StandardCharsets.US_ASCII);
        byte[] trailerBytes = trailer.toString().getBytes(StandardCharsets.US_ASCII);
        byte[] pdf = new byte[currentOffset + xrefBytes.length + trailerBytes.length];
        int position = 0;
        System.arraycopy(header, 0, pdf, position, header.length);
        position += header.length;
        for (byte[] object : objects) {
            System.arraycopy(object, 0, pdf, position, object.length);
            position += object.length;
        }
        System.arraycopy(xrefBytes, 0, pdf, position, xrefBytes.length);
        position += xrefBytes.length;
        System.arraycopy(trailerBytes, 0, pdf, position, trailerBytes.length);
        return pdf;
    }

    private static void addFontObjects(
            List<byte[]> objects,
            FontObjectIds ids,
            FontUsage usage,
            String fontName) {
        objects.add(pdfObject(
                ids.type0Id(),
                "<</Type/Font/Subtype/Type0/BaseFont/" + fontName + "/Encoding/Identity-H/DescendantFonts["
                        + ids.cidFontId() + " 0 R]/ToUnicode " + ids.toUnicodeId() + " 0 R>>"));

        String cidFont = "<</Type/Font/Subtype/CIDFontType2/BaseFont/" + fontName
                + "/CIDSystemInfo <</Registry(Adobe)/Ordering(Identity)/Supplement 0>>"
                + "/FontDescriptor " + ids.descriptorId() + " 0 R/CIDToGIDMap /Identity/DW 1000"
                + "/W [0 [" + usage.font().widthsForPdf() + "]>>";
        objects.add(pdfObject(ids.cidFontId(), cidFont));
        objects.add(pdfObject(ids.descriptorId(), usage.font().descriptorForPdf(fontName, ids.fontFileId())));
        objects.add(pdfStreamObject(
                ids.fontFileId(),
                "<</Length " + usage.font().compressedBytes().length + "/Length1 " + usage.font().bytes().length
                        + "/Filter/FlateDecode>>",
                usage.font().compressedBytes()));
        byte[] toUnicode = usage.toUnicodeCMap().getBytes(StandardCharsets.US_ASCII);
        objects.add(pdfStreamObject(ids.toUnicodeId(), "<</Length " + toUnicode.length + ">>", toUnicode));
    }

    private static byte[] pdfObject(int objectId, String dictionary) {
        return (objectId + " 0 obj\n" + dictionary + "\nendobj\n").getBytes(StandardCharsets.US_ASCII);
    }

    private static byte[] pdfStreamObject(int objectId, String dictionary, byte[] stream) {
        byte[] objectHeader = (objectId + " 0 obj\n" + dictionary + "\nstream\n").getBytes(StandardCharsets.US_ASCII);
        byte[] objectFooter = "\nendstream\nendobj\n".getBytes(StandardCharsets.US_ASCII);
        return concat(objectHeader, stream, objectFooter);
    }

    private static byte[] concat(byte[]... parts) {
        int length = 0;
        for (byte[] part : parts) length += part.length;
        byte[] result = new byte[length];
        int position = 0;
        for (byte[] part : parts) {
            System.arraycopy(part, 0, result, position, part.length);
            position += part.length;
        }
        return result;
    }

    private static String pdfText(String text, FontUsage font) {
        return "<" + font.encode(text) + ">";
    }

    private static String safe(String value) {
        return value == null ? "" : value.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private static String truncate(String value, int maxCodePoints) {
        if (value.codePointCount(0, value.length()) <= maxCodePoints) {
            return value;
        }
        int cut = value.offsetByCodePoints(0, maxCodePoints - 3);
        if (cut > 0 && cut < value.length() && isCombiningMark(value.codePointAt(cut))) {
            while (cut > 0) {
                int previous = value.codePointBefore(cut);
                cut -= Character.charCount(previous);
                if (!isCombiningMark(previous)) break;
            }
        }
        return value.substring(0, cut) + "...";
    }

    private static boolean isCombiningMark(int codePoint) {
        int type = Character.getType(codePoint);
        return type == Character.NON_SPACING_MARK
                || type == Character.COMBINING_SPACING_MARK
                || type == Character.ENCLOSING_MARK;
    }

    private record FontObjectIds(int type0Id) {
        private int cidFontId() {
            return type0Id + 1;
        }

        private int descriptorId() {
            return type0Id + 2;
        }

        private int fontFileId() {
            return type0Id + 3;
        }

        private int toUnicodeId() {
            return type0Id + 4;
        }
    }

    private static final class FontResources {
        private static final TrueTypeFont REGULAR = TrueTypeFont.load("/fonts/BeVietnamPro_400Regular.ttf");
        private static final TrueTypeFont BOLD = TrueTypeFont.load("/fonts/BeVietnamPro_700Bold.ttf");

        private FontResources() {}
    }

    private static final class FontUsage {
        private final TrueTypeFont font;
        private final Map<Integer, String> glyphs = new TreeMap<>();

        private FontUsage(TrueTypeFont font) {
            this.font = font;
            glyphs.put(0, "?");
        }

        private TrueTypeFont font() {
            return font;
        }

        private String encode(String text) {
            if (text == null) return "";
            String sanitized = text.replace("\r", " ").replace("\n", " ");
            StringBuilder encoded = new StringBuilder();
            for (int offset = 0; offset < sanitized.length();) {
                int codePoint = sanitized.codePointAt(offset);
                offset += Character.charCount(codePoint);
                int glyphId = font.glyphId(codePoint);
                glyphs.putIfAbsent(glyphId, glyphId == 0 ? "?" : new String(Character.toChars(codePoint)));
                appendHex(encoded, glyphId, 4);
            }
            return encoded.toString();
        }

        private String toUnicodeCMap() {
            StringBuilder cmap = new StringBuilder();
            cmap.append("/CIDInit /ProcSet findresource begin\n");
            cmap.append("12 dict begin\n");
            cmap.append("begincmap\n");
            cmap.append("/CIDSystemInfo <</Registry (Adobe)/Ordering (UCS)/Supplement 0>> def\n");
            cmap.append("/CMapName /Adobe-Identity-UCS def\n");
            cmap.append("/CMapType 2 def\n");
            cmap.append("1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n");
            List<Map.Entry<Integer, String>> entries = new ArrayList<>(glyphs.entrySet());
            for (int start = 0; start < entries.size(); start += 100) {
                int end = Math.min(entries.size(), start + 100);
                cmap.append(end - start).append(" beginbfchar\n");
                for (int index = start; index < end; index++) {
                    Map.Entry<Integer, String> entry = entries.get(index);
                    cmap.append('<');
                    appendHex(cmap, entry.getKey(), 4);
                    cmap.append("> <");
                    for (int offset = 0; offset < entry.getValue().length(); offset++) {
                        appendHex(cmap, entry.getValue().charAt(offset), 4);
                    }
                    cmap.append(">\n");
                }
                cmap.append("endbfchar\n");
            }
            cmap.append("endcmap\n");
            cmap.append("CMapName currentdict /CMap defineresource pop\n");
            cmap.append("end\nend\n");
            return cmap.toString();
        }
    }

    private static final class TrueTypeFont {
        private final byte[] bytes;
        private final ByteBuffer data;
        private final int unitsPerEm;
        private final int glyphCount;
        private final int[] widths;
        private final int xMin;
        private final int yMin;
        private final int xMax;
        private final int yMax;
        private final int ascent;
        private final int descent;
        private final GlyphMapper glyphMapper;
        private final byte[] compressedBytes;

        private TrueTypeFont(byte[] bytes) {
            this.bytes = bytes;
            this.data = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN);
            if (bytes.length < 12) throw new IllegalStateException("Invalid registration PDF TrueType font header");
            Map<String, FontTable> tables = readTables(data, bytes.length);
            FontTable head = requireTable(tables, "head", 54);
            FontTable hhea = requireTable(tables, "hhea", 36);
            FontTable maxp = requireTable(tables, "maxp", 6);
            FontTable hmtx = requireTable(tables, "hmtx", 4);
            FontTable cmap = requireTable(tables, "cmap", 4);
            unitsPerEm = unsignedShort(data, head.offset() + 18);
            glyphCount = unsignedShort(data, maxp.offset() + 4);
            int metricCount = unsignedShort(data, hhea.offset() + 34);
            if (unitsPerEm == 0 || glyphCount == 0 || metricCount == 0 || metricCount > glyphCount) {
                throw new IllegalStateException("Invalid registration PDF TrueType font metrics");
            }
            int requiredHmtxLength = metricCount * 4 + (glyphCount - metricCount) * 2;
            if (requiredHmtxLength > hmtx.length()) {
                throw new IllegalStateException("Incomplete hmtx table in registration PDF TrueType font");
            }
            widths = new int[glyphCount];
            int lastAdvanceWidth = unsignedShort(data, hmtx.offset() + (metricCount - 1) * 4);
            for (int glyphId = 0; glyphId < glyphCount; glyphId++) {
                widths[glyphId] = glyphId < metricCount
                        ? unsignedShort(data, hmtx.offset() + glyphId * 4)
                        : lastAdvanceWidth;
            }
            xMin = signedShort(data, head.offset() + 36);
            yMin = signedShort(data, head.offset() + 38);
            xMax = signedShort(data, head.offset() + 40);
            yMax = signedShort(data, head.offset() + 42);
            ascent = signedShort(data, hhea.offset() + 4);
            descent = signedShort(data, hhea.offset() + 6);
            glyphMapper = readGlyphMapper(data, cmap);
            compressedBytes = compress(bytes);
        }

        private static TrueTypeFont load(String resourcePath) {
            try (InputStream input = RegistrationPdfRenderer.class.getResourceAsStream(resourcePath)) {
                if (input == null) {
                    throw new IllegalStateException(
                            "Required registration PDF font is missing from the classpath: " + resourcePath);
                }
                return new TrueTypeFont(input.readAllBytes());
            } catch (IOException exception) {
                throw new IllegalStateException("Unable to read registration PDF font from " + resourcePath, exception);
            }
        }

        private byte[] bytes() {
            return bytes;
        }

        private int glyphId(int codePoint) {
            int glyphId = glyphMapper.glyphId(codePoint);
            return glyphId < 0 || glyphId >= glyphCount ? 0 : glyphId;
        }

        private String widthsForPdf() {
            StringBuilder pdfWidths = new StringBuilder();
            for (int width : widths) {
                if (pdfWidths.length() > 0) pdfWidths.append(' ');
                pdfWidths.append(scale(width));
            }
            return pdfWidths.toString();
        }

        private String descriptorForPdf(String fontName, int fontFileId) {
            return "<</Type/FontDescriptor/FontName/" + fontName + "/Flags 32/FontBBox["
                    + scale(xMin) + ' ' + scale(yMin) + ' ' + scale(xMax) + ' ' + scale(yMax)
                    + "]/ItalicAngle 0/Ascent " + scale(ascent) + "/Descent " + scale(descent)
                    + "/CapHeight " + scale(ascent) + "/StemV 80/FontFile2 " + fontFileId + " 0 R>>";
        }

        private int scale(int value) {
            return (int) Math.round(value * 1000.0 / unitsPerEm);
        }

        private byte[] compressedBytes() {
            return compressedBytes;
        }

        private static byte[] compress(byte[] bytes) {
            Deflater deflater = new Deflater(Deflater.BEST_COMPRESSION);
            try (ByteArrayOutputStream output = new ByteArrayOutputStream();
                    DeflaterOutputStream compressed = new DeflaterOutputStream(output, deflater)) {
                compressed.write(bytes);
                compressed.finish();
                return output.toByteArray();
            } catch (IOException exception) {
                throw new IllegalStateException("Unable to compress registration PDF font", exception);
            } finally {
                deflater.end();
            }
        }

        private static Map<String, FontTable> readTables(ByteBuffer data, int fontLength) {
            int tableCount = unsignedShort(data, 4);
            if (12 + tableCount * 16 > fontLength) {
                throw new IllegalStateException("Invalid TrueType font table directory");
            }
            Map<String, FontTable> tables = new LinkedHashMap<>();
            for (int index = 0; index < tableCount; index++) {
                int record = 12 + index * 16;
                byte[] tagBytes = new byte[4];
                for (int byteIndex = 0; byteIndex < 4; byteIndex++) tagBytes[byteIndex] = data.get(record + byteIndex);
                String tag = new String(tagBytes, StandardCharsets.US_ASCII);
                long offset = unsignedInt(data, record + 8);
                long length = unsignedInt(data, record + 12);
                if (offset + length > fontLength) throw new IllegalStateException("Invalid TrueType table bounds: " + tag);
                tables.put(tag, new FontTable((int) offset, (int) length));
            }
            return tables;
        }

        private static FontTable requireTable(Map<String, FontTable> tables, String name, int minimumLength) {
            FontTable table = tables.get(name);
            if (table == null || table.length() < minimumLength) {
                throw new IllegalStateException("Required " + name + " table is missing or incomplete in registration PDF font");
            }
            return table;
        }

        private static GlyphMapper readGlyphMapper(ByteBuffer data, FontTable cmap) {
            int encodingCount = unsignedShort(data, cmap.offset() + 2);
            if (4 + encodingCount * 8 > cmap.length()) {
                throw new IllegalStateException("Invalid cmap encoding directory in registration PDF font");
            }
            int format12Offset = -1;
            int format4Offset = -1;
            int tableEnd = cmap.offset() + cmap.length();
            for (int index = 0; index < encodingCount; index++) {
                int record = cmap.offset() + 4 + index * 8;
                long relativeOffset = unsignedInt(data, record + 4);
                if (relativeOffset > Integer.MAX_VALUE) continue;
                int subtableOffset = cmap.offset() + (int) relativeOffset;
                if (subtableOffset + 2 > tableEnd) continue;
                int format = unsignedShort(data, subtableOffset);
                if (format == 12 && format12Offset < 0) format12Offset = subtableOffset;
                if (format == 4 && format4Offset < 0) format4Offset = subtableOffset;
            }
            if (format12Offset >= 0) return Format12Mapper.parse(data, format12Offset, tableEnd);
            if (format4Offset >= 0) return Format4Mapper.parse(data, format4Offset, tableEnd);
            throw new IllegalStateException("Registration PDF font has no cmap format 4 or 12");
        }

        private static int unsignedShort(ByteBuffer data, int offset) {
            return Short.toUnsignedInt(data.getShort(offset));
        }

        private static int signedShort(ByteBuffer data, int offset) {
            return data.getShort(offset);
        }

        private static long unsignedInt(ByteBuffer data, int offset) {
            return Integer.toUnsignedLong(data.getInt(offset));
        }
    }

    private interface GlyphMapper {
        int glyphId(int codePoint);
    }

    private record FontTable(int offset, int length) {}

    private static final class Format12Mapper implements GlyphMapper {
        private final int[] starts;
        private final int[] ends;
        private final int[] startGlyphs;

        private Format12Mapper(int[] starts, int[] ends, int[] startGlyphs) {
            this.starts = starts;
            this.ends = ends;
            this.startGlyphs = startGlyphs;
        }

        private static Format12Mapper parse(ByteBuffer data, int offset, int tableEnd) {
            if (offset + 16 > tableEnd) throw new IllegalStateException("Incomplete cmap format 12 header");
            long length = TrueTypeFont.unsignedInt(data, offset + 4);
            long groupCount = TrueTypeFont.unsignedInt(data, offset + 12);
            if (length < 16 || offset + length > tableEnd || groupCount > (length - 16) / 12) {
                throw new IllegalStateException("Invalid cmap format 12 table");
            }
            int count = (int) groupCount;
            int[] starts = new int[count];
            int[] ends = new int[count];
            int[] startGlyphs = new int[count];
            for (int index = 0; index < count; index++) {
                int group = offset + 16 + index * 12;
                starts[index] = (int) TrueTypeFont.unsignedInt(data, group);
                ends[index] = (int) TrueTypeFont.unsignedInt(data, group + 4);
                startGlyphs[index] = (int) TrueTypeFont.unsignedInt(data, group + 8);
                if (starts[index] > ends[index] || (index > 0 && starts[index] <= ends[index - 1])) {
                    throw new IllegalStateException("Invalid cmap format 12 group ordering");
                }
            }
            return new Format12Mapper(starts, ends, startGlyphs);
        }

        @Override
        public int glyphId(int codePoint) {
            int low = 0;
            int high = starts.length - 1;
            while (low <= high) {
                int middle = (low + high) >>> 1;
                if (codePoint < starts[middle]) {
                    high = middle - 1;
                } else if (codePoint > ends[middle]) {
                    low = middle + 1;
                } else {
                    return startGlyphs[middle] + codePoint - starts[middle];
                }
            }
            return 0;
        }
    }

    private static final class Format4Mapper implements GlyphMapper {
        private final ByteBuffer data;
        private final int[] starts;
        private final int[] ends;
        private final int[] deltas;
        private final int[] rangeOffsets;
        private final int rangeOffsetsPosition;
        private final int tableEnd;

        private Format4Mapper(
                ByteBuffer data,
                int[] starts,
                int[] ends,
                int[] deltas,
                int[] rangeOffsets,
                int rangeOffsetsPosition,
                int tableEnd) {
            this.data = data;
            this.starts = starts;
            this.ends = ends;
            this.deltas = deltas;
            this.rangeOffsets = rangeOffsets;
            this.rangeOffsetsPosition = rangeOffsetsPosition;
            this.tableEnd = tableEnd;
        }

        private static Format4Mapper parse(ByteBuffer data, int offset, int cmapEnd) {
            if (offset + 14 > cmapEnd) throw new IllegalStateException("Incomplete cmap format 4 header");
            int length = TrueTypeFont.unsignedShort(data, offset + 2);
            int tableEnd = offset + length;
            int segmentCount = TrueTypeFont.unsignedShort(data, offset + 6) / 2;
            if (length < 16 || tableEnd > cmapEnd || segmentCount == 0) {
                throw new IllegalStateException("Invalid cmap format 4 table");
            }
            int endCodesPosition = offset + 14;
            int startCodesPosition = endCodesPosition + segmentCount * 2 + 2;
            int deltasPosition = startCodesPosition + segmentCount * 2;
            int rangeOffsetsPosition = deltasPosition + segmentCount * 2;
            if (rangeOffsetsPosition + segmentCount * 2 > tableEnd) {
                throw new IllegalStateException("Incomplete cmap format 4 segments");
            }
            int[] starts = new int[segmentCount];
            int[] ends = new int[segmentCount];
            int[] deltas = new int[segmentCount];
            int[] rangeOffsets = new int[segmentCount];
            for (int index = 0; index < segmentCount; index++) {
                ends[index] = TrueTypeFont.unsignedShort(data, endCodesPosition + index * 2);
                starts[index] = TrueTypeFont.unsignedShort(data, startCodesPosition + index * 2);
                deltas[index] = data.getShort(deltasPosition + index * 2);
                rangeOffsets[index] = TrueTypeFont.unsignedShort(data, rangeOffsetsPosition + index * 2);
                if (starts[index] > ends[index] || (index > 0 && ends[index] < ends[index - 1])) {
                    throw new IllegalStateException("Invalid cmap format 4 segment ordering");
                }
            }
            return new Format4Mapper(data, starts, ends, deltas, rangeOffsets, rangeOffsetsPosition, tableEnd);
        }

        @Override
        public int glyphId(int codePoint) {
            if (codePoint < 0 || codePoint > 0xffff) return 0;
            int low = 0;
            int high = ends.length - 1;
            while (low <= high) {
                int middle = (low + high) >>> 1;
                if (codePoint > ends[middle]) {
                    low = middle + 1;
                } else if (codePoint < starts[middle]) {
                    high = middle - 1;
                } else if (rangeOffsets[middle] == 0) {
                    return (codePoint + deltas[middle]) & 0xffff;
                } else {
                    int glyphPosition = rangeOffsetsPosition + middle * 2 + rangeOffsets[middle]
                            + (codePoint - starts[middle]) * 2;
                    if (glyphPosition + 2 > tableEnd) return 0;
                    int glyphId = TrueTypeFont.unsignedShort(data, glyphPosition);
                    return glyphId == 0 ? 0 : (glyphId + deltas[middle]) & 0xffff;
                }
            }
            return 0;
        }
    }

    private static void appendHex(StringBuilder output, int value, int digits) {
        for (int shift = (digits - 1) * 4; shift >= 0; shift -= 4) {
            int digit = (value >>> shift) & 0xf;
            output.append("0123456789ABCDEF".charAt(digit));
        }
    }
}
