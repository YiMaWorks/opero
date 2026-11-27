package cn.yimakeji.opero.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.yimakeji.opero.R
import cn.yimakeji.opero.i18n.t
import cn.yimakeji.opero.ui.theme.Opero

/** 连不上自己那套 Opero（没网、服务器挂了）：说清楚原因，给「重试」；不退出登录 */
@Composable
fun ErrorScreen(message: String, onRetry: () -> Unit, onLogout: () -> Unit) {
    val c = Opero.colors
    Column(
        Modifier.fillMaxSize().background(c.bg).padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    ) {
        Image(painterResource(R.drawable.ic_mark), contentDescription = null, Modifier.size(48.dp))
        Text(message, color = c.text, fontSize = 15.sp, textAlign = TextAlign.Center)
        Button(
            onClick = onRetry, shape = RoundedCornerShape(8.dp),
            colors = ButtonDefaults.buttonColors(containerColor = c.primary, contentColor = Color.White),
        ) { Text(t("重试")) }
        TextButton(onClick = onLogout) { Text(t("退出登录"), color = c.sub) }
    }
}
