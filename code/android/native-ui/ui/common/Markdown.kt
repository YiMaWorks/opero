package cn.yimakeji.opero.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.yimakeji.opero.ui.theme.Opero
import cn.yimakeji.opero.ui.theme.OperoColors

/**
 * 员工回复的 Markdown（够聊天用的那部分，和网页 components/Markdown.tsx 看起来一样）：
 * 标题、段落、粗体、斜体、删除线、行内代码、代码块（横向滚动）、有序 / 无序列表、引用、表格（等宽、横向滚动）、链接、裸网址、分隔线。
 */
private sealed interface Block {
    data class Heading(val level: Int, val text: String) : Block
    data class Para(val text: String) : Block
    data class Code(val text: String) : Block
    data class Quote(val text: String) : Block
    data class Item(val marker: String, val text: String, val depth: Int) : Block
    data class Table(val rows: List<List<String>>) : Block
    data object Rule : Block
}

private fun parse(src: String): List<Block> {
    val out = ArrayList<Block>()
    val lines = src.replace("\r\n", "\n").split("\n")
    var i = 0
    val para = StringBuilder()
    fun flush() { if (para.isNotBlank()) out.add(Block.Para(para.toString().trim())); para.setLength(0) }
    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trimStart()
        when {
            trimmed.startsWith("```") || trimmed.startsWith("~~~") -> {
                flush()
                val fence = trimmed.take(3)
                val body = StringBuilder()
                i++
                while (i < lines.size && !lines[i].trimStart().startsWith(fence)) { body.append(lines[i]).append('\n'); i++ }
                out.add(Block.Code(body.toString().trimEnd('\n')))
            }
            trimmed.isEmpty() -> flush()
            Regex("^#{1,6}\\s").containsMatchIn(trimmed) -> {
                flush()
                val level = trimmed.takeWhile { it == '#' }.length
                out.add(Block.Heading(level, trimmed.drop(level).trim().trimEnd('#').trim()))
            }
            Regex("^([-*_])(\\s*\\1){2,}\\s*$").matches(trimmed) -> { flush(); out.add(Block.Rule) }
            trimmed.startsWith(">") -> {
                flush()
                val q = StringBuilder()
                while (i < lines.size && lines[i].trimStart().startsWith(">")) { q.append(lines[i].trimStart().removePrefix(">").removePrefix(" ")).append('\n'); i++ }
                out.add(Block.Quote(q.toString().trim()))
                continue
            }
            Regex("^([-*+]|\\d{1,3}[.)])\\s+").containsMatchIn(trimmed) -> {
                flush()
                val m = Regex("^([-*+]|\\d{1,3}[.)])\\s+(.*)$").find(trimmed)!!
                val marker = m.groupValues[1].let { if (it in listOf("-", "*", "+")) "•" else it }
                val depth = (line.length - trimmed.length) / 2
                out.add(Block.Item(marker, m.groupValues[2], depth.coerceAtMost(3)))
            }
            trimmed.startsWith("|") && i + 1 < lines.size && Regex("^\\|?\\s*:?-{2,}").containsMatchIn(lines[i + 1].trim()) -> {
                flush()
                val rows = ArrayList<List<String>>()
                rows.add(cells(trimmed))
                i += 2
                while (i < lines.size && lines[i].trimStart().startsWith("|")) { rows.add(cells(lines[i].trim())); i++ }
                out.add(Block.Table(rows))
                continue
            }
            else -> { if (para.isNotEmpty()) para.append('\n'); para.append(line) }
        }
        i++
    }
    flush()
    return out
}

private fun cells(row: String) = row.trim().trim('|').split("|").map { it.trim() }

private val INLINE = Regex(
    "(`[^`]+`)" + // 行内代码
        "|(\\*\\*[^*]+\\*\\*|__[^_]+__)" + // 粗体
        "|(~~[^~]+~~)" + // 删除线
        "|(\\[[^\\]]+\\]\\([^)\\s]+\\))" + // 链接
        "|(https?://[^\\s<>()（）]+)" + // 裸网址
        "|(\\*[^*\\s][^*]*\\*|(?<![\\w])_[^_\\s][^_]*_(?![\\w]))", // 斜体
)

/** 一行里的粗体、斜体、代码、链接 → AnnotatedString（链接点了用系统打开） */
fun inline(text: String, c: OperoColors, base: SpanStyle = SpanStyle()): AnnotatedString = buildAnnotatedString {
    var last = 0
    val links = TextLinkStyles(SpanStyle(color = c.primary, textDecoration = TextDecoration.Underline))
    for (m in INLINE.findAll(text)) {
        if (m.range.first > last) withStyle(base) { append(text.substring(last, m.range.first)) }
        val v = m.value
        when {
            m.groups[1] != null -> withStyle(base.merge(SpanStyle(fontFamily = FontFamily.Monospace, background = c.panel2, fontSize = 13.sp))) { append(v.trim('`')) }
            m.groups[2] != null -> withStyle(base.merge(SpanStyle(fontWeight = FontWeight.SemiBold))) { append(v.drop(2).dropLast(2)) }
            m.groups[3] != null -> withStyle(base.merge(SpanStyle(textDecoration = TextDecoration.LineThrough))) { append(v.drop(2).dropLast(2)) }
            m.groups[4] != null -> {
                val label = v.substring(1, v.indexOf("]("))
                val url = v.substring(v.indexOf("](") + 2, v.length - 1)
                if (url.startsWith("http")) withLink(LinkAnnotation.Url(url, links)) { append(label) } else append(label)
            }
            m.groups[5] != null -> {
                val url = v.trimEnd('.', ',', '。', '，', ';', '；', ':', '：')
                withLink(LinkAnnotation.Url(url, links)) { append(url) }
                if (url.length < v.length) append(v.substring(url.length))
            }
            else -> withStyle(base.merge(SpanStyle(fontStyle = FontStyle.Italic))) { append(v.drop(1).dropLast(1)) }
        }
        last = m.range.last + 1
    }
    if (last < text.length) withStyle(base) { append(text.substring(last)) }
}

@Composable
fun Markdown(text: String, color: Color = Opero.colors.text, modifier: Modifier = Modifier) {
    val c = Opero.colors
    val blocks = remember(text) { parse(text) }
    SelectionContainer(modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (b in blocks) when (b) {
                is Block.Heading -> Text(inline(b.text, c), color = color, fontWeight = FontWeight.SemiBold, fontSize = when (b.level) { 1 -> 18.sp; 2 -> 17.sp; else -> 16.sp })
                is Block.Para -> Text(inline(b.text, c), color = color, fontSize = 15.sp, lineHeight = 22.sp)
                is Block.Code -> Text(
                    b.text, color = color, fontFamily = FontFamily.Monospace, fontSize = 12.5.sp, lineHeight = 18.sp, softWrap = false,
                    modifier = Modifier.fillMaxWidth().background(c.panel2, RoundedCornerShape(8.dp)).horizontalScroll(rememberScrollState()).padding(10.dp),
                )
                is Block.Quote -> {
                    val bar = c.line
                    Text(
                        inline(b.text, c), color = c.sub, fontSize = 15.sp, lineHeight = 22.sp,
                        modifier = Modifier.drawBehind { drawRect(bar, size = Size(3.dp.toPx(), size.height)) }.padding(start = 11.dp),
                    )
                }
                is Block.Item -> Row(Modifier.padding(start = (b.depth * 14).dp)) {
                    Text(b.marker, color = c.sub, fontSize = 15.sp, modifier = Modifier.width(if (b.marker == "•") 14.dp else 24.dp))
                    Text(inline(b.text, c), color = color, fontSize = 15.sp, lineHeight = 22.sp)
                }
                is Block.Table -> {
                    val widths = b.rows.fold(IntArray(b.rows.maxOf { it.size })) { acc, r -> r.forEachIndexed { j, s -> acc[j] = maxOf(acc[j], s.length) }; acc }
                    val lines = b.rows.mapIndexed { ri, r ->
                        val s = r.mapIndexed { j, cell -> cell.padEnd(widths[j]) }.joinToString("  ")
                        if (ri == 0) s + "\n" + widths.joinToString("  ") { "─".repeat(it) } else s
                    }
                    Text(
                        lines.joinToString("\n"), color = color, fontFamily = FontFamily.Monospace, fontSize = 12.5.sp, lineHeight = 18.sp, softWrap = false,
                        modifier = Modifier.fillMaxWidth().background(c.panel2, RoundedCornerShape(8.dp)).horizontalScroll(rememberScrollState()).padding(10.dp),
                    )
                }
                Block.Rule -> Text("──────", color = c.line)
            }
        }
    }
}
