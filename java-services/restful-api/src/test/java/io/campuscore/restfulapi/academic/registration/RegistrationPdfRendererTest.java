package io.campuscore.restfulapi.academic.registration;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.InflaterInputStream;
import org.junit.jupiter.api.Test;

class RegistrationPdfRendererTest {

    private final RegistrationPdfRenderer renderer = new RegistrationPdfRenderer();

    @Test
    void rendersVietnameseTextWithDiacritics() throws Exception {
        java.util.List<RegistrationPdfRenderer.CourseItem> courses = java.util.List.of(
                new RegistrationPdfRenderer.CourseItem(
                        "CS201", "Lập trình hướng đối tượng", "01", 3, "enr-vi", "sec-vi"));
        byte[] pdfBytes = renderer.renderEnriched(
                "stu-vi",
                "22110001",
                "Nguyễn Thị Hằng",
                "sem-vi",
                "Học kỳ II, năm học 2026 - 2027",
                "enr-vi",
                "sec-vi",
                courses);

        String pdfString = new String(pdfBytes, StandardCharsets.ISO_8859_1);
        assertThat(pdfString).startsWith("%PDF-1.4\n");
        assertThat(pdfString).endsWith("%%EOF\r\n");
        assertThat(pdfString).contains("/Subtype/Type0");
        assertThat(pdfString).contains("/ToUnicode");

        String extracted = extractText(pdfBytes);
        assertThat(extracted).contains("TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP. HỒ CHÍ MINH");
        assertThat(extracted).contains("PHIẾU ĐĂNG KÝ HỌC PHẦN");
        assertThat(extracted).contains("Mã sinh viên / Student ID:");
        assertThat(extracted).contains("Họ và tên / Student Name:");
        assertThat(extracted).contains("Nguyễn Thị Hằng");
        assertThat(extracted).contains("Học kỳ II, năm học 2026 - 2027");
        assertThat(extracted).contains("Lập trình hướng đối tượng");
        assertThat(extracted).contains("Tổng số tín chỉ đăng ký: 3 TC");

        byte[] unsupportedTextPdf = renderer.renderEnriched(
                "stu-emoji", "22110002", "Nguyễn 😀", "sem-emoji", "Học kỳ I", "enr-emoji", "sec-emoji", courses);
        assertThat(extractText(unsupportedTextPdf)).contains("Nguyễn ?");
    }

    @Test
    void rendersValidPdfDocumentWithStandardStructure() throws Exception {
        byte[] pdfBytes = renderer.render("student-123", "sem-2026-1", "enr-abc", "sec-xyz");

        assertThat(pdfBytes).isNotNull();
        assertThat(pdfBytes.length).isGreaterThan(100);

        String pdfString = new String(pdfBytes, StandardCharsets.ISO_8859_1);

        // Header check
        assertThat(pdfString).startsWith("%PDF-1.4\n");

        // Object checks
        assertThat(pdfString).contains("1 0 obj");
        assertThat(pdfString).contains("<</Type/Catalog/Pages 2 0 R>>");
        assertThat(pdfString).contains("2 0 obj");
        assertThat(pdfString).contains("<</Type/Pages/Count 1/Kids[3 0 R]>>");
        assertThat(pdfString).contains("3 0 obj");
        assertThat(pdfString).contains("/MediaBox[0 0 612 792]");
        assertThat(pdfString).contains("4 0 obj");
        assertThat(pdfString).contains("stream\n");
        assertThat(pdfString).contains("endstream");
        assertThat(pdfString).contains("5 0 obj");
        assertThat(pdfString).contains("6 0 obj");
        assertThat(pdfString).contains("/Subtype/Type0");
        assertThat(pdfString).contains("/Subtype/CIDFontType2");
        assertThat(pdfString).contains("/CIDToGIDMap /Identity");
        assertThat(pdfString).contains("/ToUnicode");
        assertThat(pdfString).contains("/FontFile2");
        assertThat(pdfString).contains("/W [0 [");
        assertThat(pdfString).contains("/Filter/FlateDecode");

        // Content checks
        String extracted = extractText(pdfBytes);
        assertThat(extracted).contains("student-123");
        assertThat(extracted).contains("sem-2026-1");
        assertThat(extracted).contains("enr-abc");
        assertThat(extracted).contains("sec-xyz");
        assertThat(extracted).contains("CampusUTE registration slip student=student-123 semester=sem-2026-1 enrollment=enr-abc section=sec-xyz");
        assertThat(extracted).contains("TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP. HỒ CHÍ MINH");
        assertThat(extracted).doesNotContain("TRUONG DAI HOC SU PHAM");

        assertXrefOffsetsAreValid(pdfString);
    }

    @Test
    void handlesNullOrSpecialCharactersGracefully() throws Exception {
        byte[] pdfBytes = renderer.render("sv/01 (special)", "sem\\fall", "enr (1)", "sec/A");
        assertThat(pdfBytes).isNotNull();
        String pdfString = new String(pdfBytes, StandardCharsets.ISO_8859_1);
        assertThat(pdfString).contains("%%EOF\r\n");
        assertThat(extractText(pdfBytes)).contains("CampusUTE registration slip");
    }

    @Test
    void generatedPdfCanBeParsedByStandardPdfParsers() throws Exception {
        byte[] pdfBytes = renderer.render("student-test", "semester-test", "enr-test", "sec-test");
        java.nio.file.Path tempFile = java.nio.file.Files.createTempFile("slip-test", ".pdf");
        try {
            java.nio.file.Files.write(tempFile, pdfBytes);
            Process process = new ProcessBuilder("python", "-c",
                    "import pypdf; reader = pypdf.PdfReader('" + tempFile.toString().replace("\\", "/") + "'); "
                            + "assert len(reader.pages) == 1; "
                            + "text = reader.pages[0].extract_text(); "
                            + "assert 'TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT' in text; "
                            + "print(text)")
                    .redirectErrorStream(true)
                    .start();
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            int exitCode = process.waitFor();
            assertThat(exitCode).withFailMessage(output).isEqualTo(0);
            System.out.println("PDF_EXTRACTED_TEXT_BEGIN\n" + output.trim() + "\nPDF_EXTRACTED_TEXT_END");
        } finally {
            java.nio.file.Files.deleteIfExists(tempFile);
        }
    }

    @Test
    void rendersEnrichedSlipWithMultipleCoursesAndVietnameseText() throws Exception {
        java.util.List<RegistrationPdfRenderer.CourseItem> courses = java.util.List.of(
                new RegistrationPdfRenderer.CourseItem("SE402", "Phát triển ứng dụng Web", "01", 3, "enr-1", "sec-1"),
                new RegistrationPdfRenderer.CourseItem("CS201", "Cấu trúc dữ liệu & Giải thuật", "02", 4, "enr-2", "sec-2"),
                new RegistrationPdfRenderer.CourseItem("MA101", "Đại số tuyến tính", "01", 3, "enr-3", "sec-3")
        );

        byte[] pdfBytes = renderer.renderEnriched(
                "stu-01",
                "22110001",
                "Nguyễn Văn An",
                "sem-2026-1",
                "Học kỳ 1 Năm học 2026 - 2027",
                "enr-1",
                "sec-1",
                courses
        );

        assertThat(pdfBytes).isNotNull();
        String pdfString = new String(pdfBytes, StandardCharsets.ISO_8859_1);
        assertThat(pdfString).startsWith("%PDF-1.4\n");
        String extracted = extractText(pdfBytes);
        assertThat(extracted).contains("22110001");
        assertThat(extracted).contains("Nguyễn Văn An");
        assertThat(extracted).contains("Học kỳ 1 Năm học 2026 - 2027");
        assertThat(extracted).contains("Phát triển ứng dụng Web");
        assertThat(extracted).contains("Cấu trúc dữ liệu");
        assertThat(extracted).contains("Đại số tuyến tính");
        assertThat(extracted).contains("Tổng số tín chỉ đăng ký: 10 TC");

        // Parse with pypdf
        java.nio.file.Path tempFile = java.nio.file.Files.createTempFile("enriched-slip-test", ".pdf");
        try {
            java.nio.file.Files.write(tempFile, pdfBytes);
            Process process = new ProcessBuilder("python", "-c",
                    "import pypdf; reader = pypdf.PdfReader('" + tempFile.toString().replace("\\", "/") + "'); "
                            + "assert len(reader.pages) == 1; "
                            + "text = reader.pages[0].extract_text(); "
                            + "assert '22110001' in text; "
                            + "assert 'Nguyễn Văn An' in text; "
                            + "assert 'Phát triển ứng dụng Web' in text; "
                            + "assert '10 TC' in text; "
                            + "print(text)")
                    .redirectErrorStream(true)
                    .start();
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            int exitCode = process.waitFor();
            assertThat(exitCode).withFailMessage(output).isEqualTo(0);
            System.out.println("PDF_EXTRACTED_TEXT_BEGIN\n" + output.trim() + "\nPDF_EXTRACTED_TEXT_END");
        } finally {
            java.nio.file.Files.deleteIfExists(tempFile);
        }
    }

    @Test
    void rendersAllCoursesAcrossPagesAndTotalsAllCredits() throws Exception {
        java.util.List<RegistrationPdfRenderer.CourseItem> courses = java.util.stream.IntStream.rangeClosed(1, 13)
                .mapToObj(index -> new RegistrationPdfRenderer.CourseItem(
                        "COURSE-" + index,
                        "Course " + index,
                        String.format("%02d", index),
                        1,
                        "enr-" + index,
                        "sec-" + index))
                .toList();

        byte[] pdfBytes = renderer.renderEnriched(
                "student-13",
                "22110013",
                "Student Thirteen",
                "sem-2026-1",
                "Semester 1",
                "enr-1",
                "sec-1",
                courses);

        String pdfString = new String(pdfBytes, StandardCharsets.ISO_8859_1);
        String extracted = extractText(pdfBytes);
        for (int index = 1; index <= 13; index++) {
            assertThat(extracted).contains("COURSE-" + index);
        }
        assertThat(extracted).contains("Tổng số tín chỉ đăng ký: 13 TC");
        assertThat(pdfString).contains("/Count 2");
        assertThat(pdfString.split("/Type/Page/Parent", -1)).hasSize(3);
        assertXrefOffsetsAreValid(pdfString);

        java.nio.file.Path tempFile = java.nio.file.Files.createTempFile("multi-page-slip-test", ".pdf");
        try {
            java.nio.file.Files.write(tempFile, pdfBytes);
            Process process = new ProcessBuilder("python", "-c",
                    "import pypdf; reader = pypdf.PdfReader('" + tempFile.toString().replace("\\", "/") + "'); "
                            + "assert len(reader.pages) == 2; "
                            + "text = ' '.join(page.extract_text() or '' for page in reader.pages); "
                            + "assert 'COURSE-13' in text; "
                            + "assert '13 TC' in text; "
                            + "print('Parsed two-page registration slip successfully!')")
                    .redirectErrorStream(true)
                    .start();
            assertThat(process.waitFor()).isEqualTo(0);
        } finally {
            java.nio.file.Files.deleteIfExists(tempFile);
        }
    }

    @Test
    void keepsByteIdenticalOutputForUnchangedInputs() throws Exception {
        assertThat(sha256(renderer.render("student-123", "sem-2026-1", "enr-abc", "sec-xyz")))
                .isEqualTo("fe51f8241efd1c49fe18b60d07f8b1bfb6331782f4177491ddac74f436659aa9");

        java.util.List<RegistrationPdfRenderer.CourseItem> courses = java.util.List.of(
                new RegistrationPdfRenderer.CourseItem(
                        "CS201", "Lập trình hướng đối tượng", "01", 3, "enr-vi", "sec-vi"));
        byte[] enriched = renderer.renderEnriched(
                "stu-vi",
                "22110001",
                "Nguyễn Thị Hằng",
                "sem-vi",
                "Học kỳ II, năm học 2026 - 2027",
                "enr-vi",
                "sec-vi",
                courses);
        assertThat(sha256(enriched))
                .isEqualTo("9442e5aa36d44fa80e6cf9a1313c8dc5e784ca6dcbf6f36b790a6950556c9cca");
    }

    @Test
    void publishesCompressedFontBytesAtLoadTime() throws Exception {
        Class<?> resources = Class.forName(
                "io.campuscore.restfulapi.academic.registration.RegistrationPdfRenderer$FontResources");
        java.lang.reflect.Field regularField = resources.getDeclaredField("REGULAR");
        regularField.setAccessible(true);
        Object font = regularField.get(null);
        java.lang.reflect.Field compressedField = font.getClass().getDeclaredField("compressedBytes");
        assertThat(java.lang.reflect.Modifier.isFinal(compressedField.getModifiers()))
                .withFailMessage("compressed font bytes must be safely published")
                .isTrue();
        compressedField.setAccessible(true);
        assertThat((byte[]) compressedField.get(font)).isNotEmpty();
    }

    @Test
    void truncatesCourseNamesOnCodePointBoundaries() throws Exception {
        String emojiName = "😀".repeat(40);
        byte[] emojiPdf = renderEnrichedWithCourseName(emojiName);
        String emojiExtracted = extractText(emojiPdf);
        assertThat(emojiExtracted.lines()).contains("?".repeat(33) + "...");
        assertThat(hasLoneSurrogate(emojiExtracted)).isFalse();
        assertNoLoneSurrogatesInUnicodeMaps(emojiPdf);

        String vietnameseName = "Lập trình hướng đối tượng nâng cao mở rộng";
        String vietnameseExtracted = extractText(renderEnrichedWithCourseName(vietnameseName));
        assertThat(vietnameseExtracted.lines()).contains(graphemeSafePrefix(vietnameseName, 33) + "...");

        String decomposedName = java.text.Normalizer.normalize(vietnameseName, java.text.Normalizer.Form.NFD);
        String decomposedExtracted = extractText(renderEnrichedWithCourseName(decomposedName));
        assertThat(decomposedExtracted.lines()).contains(graphemeSafePrefix(decomposedName, 33) + "...");
        assertThat(hasLoneSurrogate(decomposedExtracted)).isFalse();
    }

    @Test
    void truncatesLongNamesAndLegacyLineInsideThePage() throws Exception {
        String studentName = "Nguyễn Văn An ".repeat(20).trim();
        String semesterName = "Học kỳ II, năm học 2026 - 2027 ".repeat(3).trim();
        String studentId = "student-" + "x".repeat(80);
        String semesterId = "semester-" + "y".repeat(80);
        String enrollmentId = "enrollment-" + "z".repeat(80);
        String sectionId = "section-" + "w".repeat(80);
        byte[] pdf = renderer.renderEnriched(
                studentId,
                "22110001",
                studentName,
                semesterId,
                semesterName,
                enrollmentId,
                sectionId,
                java.util.List.of(new RegistrationPdfRenderer.CourseItem(
                        "CS101", "Nhập môn lập trình", "01", 3, enrollmentId, sectionId)));
        String extracted = extractText(pdf);

        String expectedStudentName = studentName.substring(0, studentName.offsetByCodePoints(0, 21)) + "...";
        assertThat(extracted.lines()).contains(expectedStudentName);
        String expectedSemesterName = semesterName.substring(0, semesterName.offsetByCodePoints(0, 30)) + "...";
        assertThat(extracted.lines()).contains(expectedSemesterName);

        String legacyLine = "CampusUTE registration slip student=" + studentId
                + " semester=" + semesterId
                + " enrollment=" + enrollmentId
                + " section=" + sectionId;
        assertThat(extracted.lines()).contains(legacyLine.substring(0, legacyLine.offsetByCodePoints(0, 99)) + "...");
        assertThat(extracted).doesNotContain(studentName);
        assertThat(extracted).doesNotContain(legacyLine);
        assertThat(extracted.lines()
                .filter(line -> line.startsWith("CampusUTE registration slip"))
                .mapToInt(line -> line.codePointCount(0, line.length()))
                .max()
                .orElse(0))
                .isLessThanOrEqualTo(102);
    }

    private byte[] renderEnrichedWithCourseName(String courseName) {
        return renderer.renderEnriched(
                "stu-1",
                "22110001",
                "Short Name",
                "sem-1",
                "Semester 1",
                "enr-1",
                "sec-1",
                java.util.List.of(new RegistrationPdfRenderer.CourseItem(
                        "CS101", courseName, "01", 3, "enr-1", "sec-1")));
    }

    private static String sha256(byte[] value) throws Exception {
        return java.util.HexFormat.of().formatHex(
                java.security.MessageDigest.getInstance("SHA-256").digest(value));
    }

    private static String graphemeSafePrefix(String text, int maxCodePoints) {
        int maxOffset = text.offsetByCodePoints(0, Math.min(maxCodePoints, text.codePointCount(0, text.length())));
        java.text.BreakIterator boundaries = java.text.BreakIterator.getCharacterInstance();
        boundaries.setText(text);
        int end = 0;
        while (boundaries.next() != java.text.BreakIterator.DONE && boundaries.current() <= maxOffset) {
            end = boundaries.current();
        }
        return text.substring(0, end);
    }

    private static boolean hasLoneSurrogate(String text) {
        for (int index = 0; index < text.length(); index++) {
            char character = text.charAt(index);
            if (Character.isHighSurrogate(character)) {
                if (index + 1 >= text.length() || !Character.isLowSurrogate(text.charAt(index + 1))) {
                    return true;
                }
                index++;
            } else if (Character.isLowSurrogate(character)) {
                return true;
            }
        }
        return false;
    }

    private static void assertNoLoneSurrogatesInUnicodeMaps(byte[] pdfBytes) {
        String pdf = new String(pdfBytes, StandardCharsets.US_ASCII);
        Matcher mapping = Pattern.compile("<([0-9A-Fa-f]{4})>\\s*<([0-9A-Fa-f]+)>").matcher(pdf);
        while (mapping.find()) {
            String hex = mapping.group(2);
            StringBuilder value = new StringBuilder();
            for (int index = 0; index + 4 <= hex.length(); index += 4) {
                value.append((char) Integer.parseInt(hex.substring(index, index + 4), 16));
            }
            assertThat(hasLoneSurrogate(value.toString()))
                    .withFailMessage("Unicode map contains a lone surrogate: " + hex)
                    .isFalse();
        }
    }

    private static void assertXrefOffsetsAreValid(String pdfString) {
        String startXrefMarker = "startxref\r\n";
        int startXrefValue = pdfString.indexOf(startXrefMarker) + startXrefMarker.length();
        int endXrefValue = pdfString.indexOf("\r\n%%EOF", startXrefValue);
        int xrefOffset = Integer.parseInt(pdfString.substring(startXrefValue, endXrefValue));
        String xrefHeader = "xref\r\n0 ";
        assertThat(pdfString.substring(xrefOffset)).startsWith(xrefHeader);

        int countStart = xrefOffset + xrefHeader.length();
        int countEnd = pdfString.indexOf("\r\n", countStart);
        int objectCount = Integer.parseInt(pdfString.substring(countStart, countEnd));
        int entriesStart = countEnd + 2;
        assertThat(pdfString.substring(entriesStart, entriesStart + 20)).isEqualTo("0000000000 65535 f\r\n");

        for (int objectNumber = 1; objectNumber < objectCount; objectNumber++) {
            int entryStart = entriesStart + objectNumber * 20;
            int objectOffset = Integer.parseInt(pdfString.substring(entryStart, entryStart + 10));
            assertThat(pdfString.substring(objectOffset)).startsWith(objectNumber + " 0 obj\n");
        }
        assertThat(pdfString).contains("trailer\r\n<</Size " + objectCount + "/Root 1 0 R>>\r\n");
        assertThat(pdfString).endsWith("%%EOF\r\n");
    }

    private static String extractText(byte[] pdfBytes) throws IOException {
        String pdf = new String(pdfBytes, StandardCharsets.ISO_8859_1);
        String startXrefMarker = "startxref\r\n";
        int startXref = Integer.parseInt(pdf.substring(
                pdf.indexOf(startXrefMarker) + startXrefMarker.length(),
                pdf.indexOf("\r\n%%EOF", pdf.indexOf(startXrefMarker))));
        int xrefHeader = pdf.indexOf("xref\r\n0 ", startXref);
        int countStart = xrefHeader + "xref\r\n0 ".length();
        int countEnd = pdf.indexOf("\r\n", countStart);
        int objectCount = Integer.parseInt(pdf.substring(countStart, countEnd));
        int entriesStart = countEnd + 2;
        int[] offsets = new int[objectCount];
        for (int objectNumber = 1; objectNumber < objectCount; objectNumber++) {
            int entryStart = entriesStart + objectNumber * 20;
            offsets[objectNumber] = Integer.parseInt(pdf.substring(entryStart, entryStart + 10));
        }

        Map<Integer, PdfObject> objects = new HashMap<>();
        Map<Integer, Map<Integer, String>> unicodeMaps = new HashMap<>();
        for (int objectNumber = 1; objectNumber < objectCount; objectNumber++) {
            int nextOffset = objectNumber + 1 < objectCount ? offsets[objectNumber + 1] : startXref;
            PdfObject object = readObject(pdfBytes, offsets[objectNumber], nextOffset);
            objects.put(objectNumber, object);
            Matcher toUnicode = Pattern.compile("/ToUnicode\\s+(\\d+)\\s+0\\s+R").matcher(object.dictionary());
            if (toUnicode.find()) {
                int unicodeObjectId = Integer.parseInt(toUnicode.group(1));
                PdfObject unicodeObject = readObject(
                        pdfBytes,
                        offsets[unicodeObjectId],
                        unicodeObjectId + 1 < objectCount ? offsets[unicodeObjectId + 1] : startXref);
                unicodeMaps.put(objectNumber, parseToUnicode(unicodeObject.stream()));
            }
        }

        StringBuilder extracted = new StringBuilder();
        Pattern contentReference = Pattern.compile("/Contents\\s+(\\d+)\\s+0\\s+R");
        Pattern regularFontReference = Pattern.compile("/F1\\s+(\\d+)\\s+0\\s+R");
        Pattern boldFontReference = Pattern.compile("/F2\\s+(\\d+)\\s+0\\s+R");
        Pattern fontSelection = Pattern.compile("/F([12])\\s+[0-9.]+\\s+Tf");
        Pattern textShow = Pattern.compile("<([0-9A-Fa-f]+)>\\s*Tj");
        for (PdfObject object : objects.values()) {
            if (!object.dictionary().contains("/Type/Page/")) continue;
            Matcher content = contentReference.matcher(object.dictionary());
            Matcher regular = regularFontReference.matcher(object.dictionary());
            Matcher bold = boldFontReference.matcher(object.dictionary());
            if (!content.find() || !regular.find() || !bold.find()) continue;
            int contentId = Integer.parseInt(content.group(1));
            Map<Integer, Map<Integer, String>> pageFonts = Map.of(
                    1, unicodeMaps.get(Integer.parseInt(regular.group(1))),
                    2, unicodeMaps.get(Integer.parseInt(bold.group(1))));
            byte[] contentBytes = objects.get(contentId).stream();
            for (String line : new String(contentBytes, StandardCharsets.US_ASCII).split("\\n")) {
                Matcher selectedFont = fontSelection.matcher(line);
                int fontNumber = 0;
                while (selectedFont.find()) fontNumber = Integer.parseInt(selectedFont.group(1));
                Matcher text = textShow.matcher(line);
                while (text.find() && fontNumber != 0) {
                    Map<Integer, String> glyphMap = pageFonts.get(fontNumber);
                    String glyphs = text.group(1);
                    for (int index = 0; index + 4 <= glyphs.length(); index += 4) {
                        int glyphId = Integer.parseInt(glyphs.substring(index, index + 4), 16);
                        extracted.append(glyphMap.getOrDefault(glyphId, ""));
                    }
                    extracted.append('\n');
                }
            }
        }
        return extracted.toString();
    }

    private static PdfObject readObject(byte[] pdfBytes, int offset, int nextOffset) throws IOException {
        String pdf = new String(pdfBytes, StandardCharsets.ISO_8859_1);
        String objectText = pdf.substring(offset, nextOffset);
        int streamMarker = objectText.indexOf("stream\n");
        int streamStart = streamMarker < 0 ? -1 : offset + streamMarker + "stream\n".length();
        String dictionary = streamMarker < 0 ? objectText : objectText.substring(0, streamMarker);
        if (streamMarker < 0) return new PdfObject(dictionary, new byte[0]);
        Matcher length = Pattern.compile("/Length\\s+(\\d+)").matcher(dictionary);
        if (!length.find()) throw new IllegalArgumentException("PDF stream has no direct length");
        int streamLength = Integer.parseInt(length.group(1));
        byte[] stream = Arrays.copyOfRange(pdfBytes, streamStart, streamStart + streamLength);
        if (dictionary.contains("/Filter/FlateDecode")) {
            try (InflaterInputStream inflater = new InflaterInputStream(new ByteArrayInputStream(stream));
                    ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                inflater.transferTo(output);
                stream = output.toByteArray();
            }
        }
        return new PdfObject(dictionary, stream);
    }

    private static Map<Integer, String> parseToUnicode(byte[] cmapBytes) {
        String cmap = new String(cmapBytes, StandardCharsets.US_ASCII);
        Matcher block = Pattern.compile("(?s)beginbfchar(.*?)endbfchar").matcher(cmap);
        Pattern mapping = Pattern.compile("<([0-9A-Fa-f]{4})>\\s*<([0-9A-Fa-f]+)>");
        Map<Integer, String> unicodeMap = new HashMap<>();
        while (block.find()) {
            Matcher entry = mapping.matcher(block.group(1));
            while (entry.find()) {
                int glyphId = Integer.parseInt(entry.group(1), 16);
                byte[] unicodeBytes = new byte[entry.group(2).length() / 2];
                for (int index = 0; index < unicodeBytes.length; index++) {
                    unicodeBytes[index] = (byte) Integer.parseInt(entry.group(2).substring(index * 2, index * 2 + 2), 16);
                }
                unicodeMap.put(glyphId, new String(unicodeBytes, StandardCharsets.UTF_16BE));
            }
        }
        return unicodeMap;
    }

    private record PdfObject(String dictionary, byte[] stream) {}
}
