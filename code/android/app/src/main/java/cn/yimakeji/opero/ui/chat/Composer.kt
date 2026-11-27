package cn.yimakeji.opero.ui.chat

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import cn.yimakeji.opero.data.Att
import cn.yimakeji.opero.data.Employee
import cn.yimakeji.opero.data.Live
import cn.yimakeji.opero.data.Session
import cn.yimakeji.opero.i18n.I18n
import cn.yimakeji.opero.i18n.t
import cn.yimakeji.opero.ui.Routes
import cn.yimakeji.opero.ui.common.LocalHost
import cn.yimakeji.opero.ui.common.RemoteImage
import cn.yimakeji.opero.ui.sessions.SheetRow
import cn.yimakeji.opero.ui.theme.Opero
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** 输入框上面一排还没发的附件：传中 / 传好（att）/ 失败 */
class Pend(val key: String, val name: String, val image: Boolean) {
    var busy by mutableStateOf(true)
    var att by mutableStateOf<Att?>(null)
    var err by mutableStateOf<String?>(null)
}

/** 附件按会话记在内存里：切走以后才传完的也记得住（和网页 pendDrafts 一样） */
object Pending {
    private val map = HashMap<String, SnapshotStateList<Pend>>()
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    fun of(sid: String): SnapshotStateList<Pend> = map.getOrPut(sid) { mutableStateListOf() }

    private const val MAX = 30L * 1024 * 1024 // 后台收文件最多 30 MB

    /** 读手机上的文件 → 先传到员工的目录（还没发） */
    fun add(context: Context, sid: String, uri: Uri) {
        val ctx = context.applicationContext
        val name = nameOf(ctx, uri)
        val type = ctx.contentResolver.getType(uri) ?: guessType(name)
        val p = Pend(System.nanoTime().toString(), name, type.startsWith("image/"))
        of(sid).add(p)
        scope.launch {
            try {
                val bytes = withContext(Dispatchers.IO) {
                    ctx.contentResolver.openInputStream(uri)?.use { ins ->
                        val b = ins.readBytes()
                        if (b.size > MAX) throw IllegalStateException(t("文件太大（最多 30 MB）"))
                        b
                    } ?: throw IllegalStateException(t("读不到这个文件"))
                }
                var w: Int? = null
                var h: Int? = null
                if (p.image) {
                    val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
                    if (o.outWidth > 0) { w = o.outWidth; h = o.outHeight }
                }
                p.att = Live.upload(sid, bytes, name, type, w, h)
            } catch (e: Exception) {
                p.err = e.message ?: t("传失败了")
            } finally {
                p.busy = false
            }
        }
    }

    fun drop(sid: String, p: Pend) {
        p.att?.let { Live.dropUpload(sid, it) }
        of(sid).remove(p)
    }

    private fun nameOf(ctx: Context, uri: Uri): String {
        try {
            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0)?.takeIf { it.isNotBlank() }?.let { return it }
            }
        } catch (_: Exception) { }
        return uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: "file"
    }

    private fun guessType(name: String) = when (name.substringAfterLast('.', "").lowercase()) {
        "png" -> "image/png"; "jpg", "jpeg" -> "image/jpeg"; "gif" -> "image/gif"; "webp" -> "image/webp"
        "pdf" -> "application/pdf"; "txt", "log" -> "text/plain"; "md" -> "text/markdown"; "json" -> "application/json"
        "csv" -> "text/csv"; "zip" -> "application/zip"; else -> "application/octet-stream"
    }
}

/**
 * 聊天底部（网页 Chat.tsx 的手机版 footer）：
 *   员工的底部菜单 + 常用语（一排小标签，能左右滑；常用语点了直接发，编辑时长按拖动排序，见 Phrases.kt）→ 附件一排 → 输入框 + 按钮。
 *   按钮：有字 / 有附件 → （在干活且不是 Codex：排队）+ 说话 + 发送；没字：在干活 → 停止，闲着 → 说话 + 附件。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Composer(
    emp: Employee,
    session: Session,
    text: String,
    onText: (String) -> Unit,
    onSend: (mode: String) -> Unit,
    sending: Boolean,
    onOpenRoute: (String) -> Unit,
) {
    val c = Opero.colors
    val ctx = LocalContext.current
    val host = LocalHost.current
    val pend = Pending.of(session.id)
    var sheet by remember { mutableStateOf<String?>(null) }
    var editPh by remember { mutableStateOf(false) }
    val phrases = Live.phrases
    val working = session.working != null
    val canSend = text.isNotBlank() || pend.any { it.att != null }

    val pickImages = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(9)) { uris -> uris.forEach { Pending.add(ctx, session.id, it) } }
    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> uris.forEach { Pending.add(ctx, session.id, it) } }
    var photo by remember { mutableStateOf<Uri?>(null) }
    val takePhoto = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> photo?.let { if (ok) Pending.add(ctx, session.id, it) } }
    val listen = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val said = r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull().orEmpty()
        if (said.isNotBlank()) onText(if (text.isBlank()) said else "$text $said")
    }
    fun talk() {
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, I18n.lang)
            .putExtra(RecognizerIntent.EXTRA_PROMPT, t("请说话"))
        try { host.skipLock(); listen.launch(i) } catch (_: Exception) { Live.toast(t("这台手机没有语音识别")) }
    }
    fun attach(kind: String) {
        sheet = null
        host.skipLock()
        when (kind) {
            "图片" -> pickImages.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            "文件" -> pickFiles.launch(arrayOf("*/*"))
            "拍照" -> {
                val dir = File(ctx.cacheDir, "camera").apply { mkdirs() }
                val f = File(dir, "photo-${System.currentTimeMillis()}.jpg")
                val u = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", f)
                photo = u
                try { takePhoto.launch(u) } catch (_: Exception) { Live.toast(t("打不开相机")) }
            }
        }
    }

    Column(Modifier.fillMaxWidth().background(c.panel)) {
        // 底部菜单 + 常用语
        if (emp.menus.isNotEmpty() || phrases.isNotEmpty() || editPh) Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 10.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            for (m in emp.menus) Chip(t(Routes.menuLabel(m, emp)), strong = true) { onOpenRoute(Routes.menu(m, emp)) }
            if (emp.menus.isNotEmpty() && phrases.isNotEmpty()) Box(Modifier.width(1.dp).height(16.dp).background(c.line))
            PhraseChips(session.id, phrases, editPh, gap = 6.dp)
            if (editPh) Chip(t("+ 存输入框里的"), strong = true) {
                val v = text.trim()
                if (v.isNotEmpty() && v !in phrases) { Live.setPhrases((phrases + v).takeLast(30)); Live.toast(t("已存成常用语")) }
            }
            Chip(if (editPh) t("完成") else if (phrases.isEmpty()) t("+ 常用语") else t("编辑")) { editPh = !editPh }
        }
        // 还没发的附件
        if (pend.isNotEmpty()) Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 10.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (p in pend) Row(
                Modifier.clip(RoundedCornerShape(8.dp)).background(if (p.err != null) c.dangerSoft else c.panel2).padding(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val a = p.att
                if (p.image && a != null) RemoteImage(a.url, Modifier.size(40.dp).clip(RoundedCornerShape(6.dp)), max = 160)
                else Text("📎", fontSize = 16.sp, modifier = Modifier.padding(horizontal = 4.dp))
                Text(
                    if (p.busy) "…" else p.err ?: p.name, color = if (p.err != null) c.danger else c.sub, fontSize = 12.sp, maxLines = 1,
                    modifier = Modifier.widthIn(max = 120.dp).padding(horizontal = 6.dp),
                )
                Text("×", color = c.faint, fontSize = 18.sp, modifier = Modifier.clickable { Pending.drop(session.id, p) }.padding(horizontal = 6.dp))
            }
        }
        // 输入框 + 按钮
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.Bottom) {
            Box(
                Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).background(c.panel2).padding(horizontal = 12.dp, vertical = 10.dp),
            ) {
                if (text.isEmpty()) Text(
                    if (working) (if (emp.codex) t("在干活，这时发 = 排队") else t("在干活，这时发 = 插话")) else t("跟「{0}」说点什么", emp.name),
                    color = c.faint, fontSize = 15.sp, maxLines = 1,
                )
                BasicTextField(
                    value = text, onValueChange = onText, maxLines = 6,
                    textStyle = TextStyle(color = c.text, fontSize = 15.sp), cursorBrush = SolidColor(c.primary),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Spacer(Modifier.width(6.dp))
            if (canSend) {
                if (working && !emp.codex) Round(t("排队"), c.panel2, c.text, enabled = !sending, wide = true) { onSend("queue") }
                Round("🎤", c.panel2, c.text) { talk() }
                Round("➤", c.primary, Color.White, enabled = !sending) { onSend("auto") }
            } else if (working) {
                Round("■", c.danger, Color.White) { Live.stop(session.id) }
            } else {
                Round("🎤", c.panel2, c.text) { talk() }
                Round("＋", c.panel2, c.text) { sheet = "attach" }
            }
        }
    }

    if (sheet == "attach") ModalBottomSheet(onDismissRequest = { sheet = null }, containerColor = c.panel) {
        for (k in listOf("图片", "拍照", "文件")) SheetRow(t(k)) { attach(k) }
        SheetRow(t("常用语")) { sheet = null; editPh = true }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun Chip(text: String, strong: Boolean = false, onClick: () -> Unit) {
    val c = Opero.colors
    Text(
        text, color = if (strong) c.primary else c.sub, fontSize = 13.sp, maxLines = 1,
        fontWeight = if (strong) FontWeight.Medium else FontWeight.Normal,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (strong) c.primarySoft else c.panel2).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 5.dp),
    )
}

@Composable
private fun Round(label: String, bg: Color, fg: Color, enabled: Boolean = true, wide: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier.padding(start = 4.dp).height(40.dp).widthIn(min = 40.dp).clip(if (wide) RoundedCornerShape(20.dp) else CircleShape).background(bg)
            .clickable(enabled = enabled, onClick = onClick).padding(horizontal = if (wide) 14.dp else 0.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = fg, fontSize = if (wide) 14.sp else 18.sp, maxLines = 1) }
}
