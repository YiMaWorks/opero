package cn.yimakeji.opero.ui.common

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.BitmapFactory
import android.util.Base64
import android.util.LruCache
import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.yimakeji.opero.data.Api
import cn.yimakeji.opero.data.Live
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** 原生页面要用到的系统能力（MainActivity 实现） */
interface AppHost {
    /** 验证本人：系统指纹 / 面容 / 锁屏密码，过了再调 POST /api/app/verified；done(true) = 可以做危险操作了 */
    fun verify(title: String, subtitle: String?, done: (Boolean) -> Unit)
    /** 用系统浏览器 / 别的 App 打开 */
    fun openExternal(url: String)
    /** 下载好的文件交给系统打开 */
    fun openFile(name: String, bytes: ByteArray, mime: String)
    fun haptic()
    /** 马上要打开选图 / 相机 / 语音这些系统界面：回来不锁 */
    fun skipLock()
}

val LocalHost = staticCompositionLocalOf<AppHost> { error("没有 AppHost") }

fun toast(ctx: Context, msg: String) { Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show() }

fun copy(ctx: Context, text: String) {
    (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager)?.setPrimaryClip(ClipData.newPlainText("Opero", text))
}

fun parseColor(hex: String, fallback: Color = Color(0xFF5B4FE9)): Color =
    try { Color(android.graphics.Color.parseColor(hex)) } catch (_: Exception) { fallback }

/** 图片缓存：自己那套 Opero 的图片要带登录（Api.bytes），按最长边 [max] 缩小后解码 */
object Images {
    private val cache = object : LruCache<String, ImageBitmap>(48 * 1024 * 1024) {
        override fun sizeOf(key: String, value: ImageBitmap) = value.width * value.height * 4
    }

    fun cached(url: String, max: Int): ImageBitmap? = cache.get("$max|$url")

    suspend fun load(url: String, max: Int): ImageBitmap? {
        cached(url, max)?.let { return it }
        val bytes = try {
            if (url.startsWith("data:")) Base64.decode(url.substringAfter(","), Base64.DEFAULT) else Api.bytes(url)
        } catch (_: Exception) { return null }
        val img = withContext(Dispatchers.Default) { decode(bytes, max) } ?: return null
        cache.put("$max|$url", img)
        return img
    }

    private fun decode(bytes: ByteArray, max: Int): ImageBitmap? {
        val opt = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opt)
        var sample = 1
        while (maxOf(opt.outWidth, opt.outHeight) / (sample * 2) >= max) sample *= 2
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        return bmp.asImageBitmap()
    }
}

/** 远程图片（带登录）；还没到时显示 [placeholder] */
@Composable
fun RemoteImage(url: String, modifier: Modifier, max: Int = 1280, scale: ContentScale = ContentScale.Crop, placeholder: @Composable () -> Unit = {}) {
    val img by produceState(Images.cached(url, max), url, max) { if (value == null) value = Images.load(url, max) }
    val bmp = img
    if (bmp != null) Image(bmp, contentDescription = null, modifier = modifier, contentScale = scale)
    else Box(modifier, contentAlignment = Alignment.Center) { placeholder() }
}

/** 头像：员工的字 / 表情 / 图片，底色是员工的颜色；id = "me" 是我 */
@Composable
fun Avatar(id: String, size: Dp, modifier: Modifier = Modifier) {
    val isMe = id == "me"
    val e = if (isMe) null else Live.employee(id)
    val me = Live.me
    val text = if (isMe) me.avatar ?: me.name.take(1).ifEmpty { "我" } else e?.avatar ?: "?"
    val img = if (isMe) me.avatarImg else e?.avatarImg
    val bg = if (isMe) Color(0xFF64748B) else parseColor(e?.color ?: "#5B4FE9")
    val emoji = text.codePoints().anyMatch { Character.getType(it) == Character.OTHER_SYMBOL.toInt() || it >= 0x1F000 }
    Box(modifier.size(size).clip(CircleShape).background(bg), contentAlignment = Alignment.Center) {
        if (img != null) RemoteImage(img, Modifier.size(size), max = 256)
        else Text(text, color = Color.White, fontSize = (size.value * if (emoji) 0.5f else 0.42f).sp, maxLines = 1)
    }
}

/** 圆点（会话列表的红点 / 灰点 / 在干活） */
@Composable
fun Dot(color: Color, size: Dp = 10.dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).clip(CircleShape).background(color))
}
