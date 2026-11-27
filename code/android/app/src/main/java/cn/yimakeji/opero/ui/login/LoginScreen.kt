package cn.yimakeji.opero.ui.login

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.net.Uri
import cn.yimakeji.opero.BuildConfig
import cn.yimakeji.opero.R
import cn.yimakeji.opero.data.Account
import cn.yimakeji.opero.data.Api
import cn.yimakeji.opero.data.ApiError
import cn.yimakeji.opero.i18n.t
import cn.yimakeji.opero.ui.theme.Opero
import kotlinx.coroutines.launch

/** 登录页走到哪一步 */
private enum class Step { SERVER, ACCOUNT, PAIR, MFA }

/**
 * 登录你的 Opero（docs/api/README.md「原生 App 登录」）：
 *   ① 地址（先查 /api/health 确认是 Opero）→ ② 账号 + 密码（主路）或配对码（可选）→ ③ 开了两步验证就输动态码。
 * 地址、账号记在本机，下次预填；被断开回来时直接从第 ② 步开始。
 */
@Composable
fun LoginScreen(notice: String?, onDone: () -> Unit) {
    val store = Api.store
    val scope = rememberCoroutineScope()
    var step by rememberSaveable { mutableStateOf(if (store.server != null) Step.ACCOUNT else Step.SERVER) }
    var server by rememberSaveable { mutableStateOf(store.server ?: BuildConfig.DEFAULT_SERVER) }
    var base by rememberSaveable { mutableStateOf(store.server) }
    var email by rememberSaveable { mutableStateOf(store.email ?: "") }
    var password by rememberSaveable { mutableStateOf("") }
    var showPwd by rememberSaveable { mutableStateOf(false) }
    var code by rememberSaveable { mutableStateOf("") }
    var ticket by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(notice) }

    fun launchStep(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try { block() } catch (e: ApiError) { error = e.message } catch (e: Exception) { error = e.message ?: t("连不上") } finally { busy = false }
        }
    }

    fun go(s: Step) { step = s; error = null; code = "" }

    val next: () -> Unit = {
        when (step) {
            Step.SERVER -> {
                val b = Account.normalize(server)
                if (b == null) error = if (server.isBlank()) t("先填地址") else t("地址不对")
                else launchStep { Account.check(b); base = b; go(Step.ACCOUNT) }
            }
            Step.ACCOUNT -> {
                val b = base
                if (b == null) go(Step.SERVER)
                else if (email.isBlank() || password.isEmpty()) error = t("账号和密码都要填")
                else launchStep {
                    when (val r = Account.login(b, email, password)) {
                        is Account.Result.Mfa -> { ticket = r.ticket; go(Step.MFA) }
                        Account.Result.Done -> { password = ""; onDone() }
                    }
                }
            }
            Step.MFA -> {
                val b = base
                if (b == null) go(Step.SERVER)
                else if (code.isBlank()) error = t("输入验证器 App 里的 6 位动态码（或者一个恢复码）")
                else launchStep {
                    try { Account.loginMfa(b, email, ticket, code); password = ""; onDone() }
                    catch (e: ApiError) { if (e.code == "LOGIN") { password = ""; step = Step.ACCOUNT }; throw e } // 票过期：回去重新输密码
                }
            }
            Step.PAIR -> {
                val b = base
                if (b == null) go(Step.SERVER)
                else if (code.isBlank()) error = t("先填配对码")
                else launchStep { Account.pair(b, code); onDone() }
            }
        }
    }

    val c = Opero.colors
    Column(
        Modifier.fillMaxSize().background(c.bg).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(24.dp))
        Image(painterResource(R.drawable.ic_mark), contentDescription = null, Modifier.size(56.dp))
        Spacer(Modifier.height(16.dp))
        Text(
            if (step == Step.SERVER) t("连接你的 Opero") else t("登录"),
            fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = c.text,
        )
        Spacer(Modifier.height(8.dp))
        Column(Modifier.widthIn(max = 420.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when (step) {
                Step.SERVER -> {
                    Hint(t("Opero 没有公共服务器，App 只连你自己服务器上装的那套。还没装？在电脑上打开 github.com/yimaworks/opero 看安装说明。"))
                    Field(server, { server = it }, t("地址"), t("https://opero.你的域名 或 http://服务器IP:7300"), KeyboardType.Uri, next)
                }
                Step.ACCOUNT, Step.PAIR, Step.MFA -> {
                    ServerRow(base) { go(Step.SERVER) }
                    when (step) {
                        Step.ACCOUNT -> {
                            Field(email, { email = it }, t("账号（邮箱）"), null, KeyboardType.Email, next, last = false)
                            Field(password, { password = it }, t("密码"), null, KeyboardType.Password, next, secret = !showPwd)
                            TextButton(onClick = { showPwd = !showPwd }, Modifier.align(Alignment.End)) {
                                Text(if (showPwd) t("隐藏密码") else t("显示密码"), color = c.sub, fontSize = 13.sp)
                            }
                        }
                        Step.PAIR -> {
                            Hint(t("在电脑上打开 Opero →「我 → 账号安全 → 接手机」拿 6 位配对码，不用在手机上输密码。"))
                            Field(code, { code = it.filter(Char::isDigit).take(6) }, t("配对码"), t("6 位数字"), KeyboardType.NumberPassword, next)
                        }
                        else -> {
                            Hint(t("输入验证器 App 里的 6 位动态码（或者一个恢复码）"))
                            Field(code, { code = it.trim().take(32) }, t("动态码"), null, KeyboardType.Ascii, next)
                        }
                    }
                }
            }
            error?.let { Text(it, color = c.danger, fontSize = 14.sp) }
            Button(
                onClick = next, enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(containerColor = c.primary, contentColor = Color.White),
            ) {
                if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                else Text(
                    when (step) { Step.SERVER -> t("下一步"); Step.PAIR -> t("连接"); else -> t("登录") },
                    fontSize = 16.sp,
                )
            }
            when (step) {
                Step.ACCOUNT -> Link(t("用配对码登录")) { go(Step.PAIR) }
                Step.PAIR -> Link(t("用账号密码登录")) { go(Step.ACCOUNT) }
                Step.MFA -> Link(t("返回")) { password = ""; go(Step.ACCOUNT) }
                Step.SERVER -> {}
            }
        }
    }
}

@Composable
private fun ServerRow(base: String?, onChange: () -> Unit) {
    val c = Opero.colors
    Row(
        Modifier.fillMaxWidth().background(c.panel, RoundedCornerShape(10.dp)).padding(start = 14.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).padding(vertical = 10.dp)) {
            Text(t("你的 Opero"), color = c.faint, fontSize = 12.sp)
            Text(base?.let { Uri.parse(it).host ?: it } ?: "", color = c.text, fontSize = 15.sp, maxLines = 1)
        }
        TextButton(onClick = onChange) { Text(t("换一个"), color = c.primary) }
    }
}

@Composable
private fun Hint(text: String) {
    Text(text, color = Opero.colors.sub, fontSize = 14.sp, lineHeight = 20.sp)
}

@Composable
private fun Link(text: String, onClick: () -> Unit) {
    TextButton(onClick = onClick, Modifier.fillMaxWidth()) { Text(text, color = Opero.colors.primary, fontSize = 14.sp) }
}

@Composable
private fun Field(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    placeholder: String?,
    type: KeyboardType,
    onGo: () -> Unit,
    secret: Boolean = false,
    last: Boolean = true,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        placeholder = if (placeholder != null) { { Text(placeholder, color = Opero.colors.faint, maxLines = 1) } } else null,
        singleLine = true,
        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = type, imeAction = if (last) ImeAction.Go else ImeAction.Next, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onGo = { onGo() }),
        shape = RoundedCornerShape(10.dp),
        textStyle = MaterialTheme.typography.bodyLarge,
        modifier = Modifier.fillMaxWidth(),
    )
}
