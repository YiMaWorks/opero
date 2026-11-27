package cn.yimakeji.opero.ui.chat

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import cn.yimakeji.opero.data.Message
import cn.yimakeji.opero.i18n.t
import cn.yimakeji.opero.ui.common.OperoIcons
import cn.yimakeji.opero.ui.common.RemoteImage

/**
 * 全屏看图（网页 components/FileView.tsx 的 ImageViewer）：左右滑看这个会话里的别的图片；
 * 下面一排：存到相册、系统分享、转给员工。点空白处或右上 × 关。
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ImageViewer(
    list: List<Message>,
    start: String,
    onClose: () -> Unit,
    onSave: (Message) -> Unit,
    onShare: (Message) -> Unit,
    onForward: (Message) -> Unit,
) {
    if (list.isEmpty()) return
    val first = list.indexOfFirst { it.id == start }.coerceAtLeast(0)
    val pager = rememberPagerState(initialPage = first) { list.size }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(pager, Modifier.fillMaxSize()) { i ->
                val f = list[i].file
                Box(Modifier.fillMaxSize().clickable(onClick = onClose), contentAlignment = Alignment.Center) {
                    if (f?.url != null) RemoteImage(f.url, Modifier.fillMaxWidth(), max = 2048, scale = ContentScale.Fit) {
                        Text(t("加载中…"), color = Color.White.copy(alpha = 0.7f))
                    }
                }
            }
            val cur = list.getOrNull(pager.currentPage)
            val f = cur?.file
            // 顶上：文件名、大小、第几张；右边关
            Row(
                Modifier.fillMaxWidth().background(Color.Black.copy(alpha = 0.45f)).systemBarsPadding().padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(f?.name ?: "", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        listOfNotNull(f?.size?.ifBlank { null }, if (list.size > 1) "${pager.currentPage + 1} / ${list.size}" else null).joinToString(" · "),
                        color = Color.White.copy(alpha = 0.7f), fontSize = 12.sp,
                    )
                }
                Box(Modifier.size(44.dp).clickable(onClick = onClose), contentAlignment = Alignment.Center) {
                    Icon(OperoIcons.Close, contentDescription = t("关闭"), tint = Color.White)
                }
            }
            // 底下：存、分享、转给员工
            if (cur != null) Row(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color.Black.copy(alpha = 0.45f)).systemBarsPadding().padding(vertical = 6.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                Action(OperoIcons.Download, t("存到相册")) { onSave(cur) }
                Action(OperoIcons.Share, t("分享")) { onShare(cur) }
                Action(OperoIcons.Forward, t("转给员工")) { onForward(cur) }
            }
        }
    }
}

@Composable
private fun Action(icon: ImageVector, label: String, onClick: () -> Unit) {
    Column(
        Modifier.clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(24.dp))
        Text(label, color = Color.White, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp))
    }
}
