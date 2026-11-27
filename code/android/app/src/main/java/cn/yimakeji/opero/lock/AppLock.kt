package cn.yimakeji.opero.lock

import cn.yimakeji.opero.Tr
import cn.yimakeji.opero.R
import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import cn.yimakeji.opero.data.Api
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * 指纹 / 面容：
 *   - 解锁 App：打开、离开超过设定时间再回来，先盖一层锁屏，验过才能看（设置里开，默认关）
 *   - 验证本人（危险操作、看明文…）：网页调 OperoNative.verify → 这里弹系统验证；5 分钟内验过不再问（和后台 VERIFY_MS 一致，docs/api/README.md「验证本人」）
 *   没录指纹 / 面容的手机可以用锁屏密码（DEVICE_CREDENTIAL）
 */
object AppLock {
    const val AUTH = BIOMETRIC_WEAK or DEVICE_CREDENTIAL
    val locked = MutableStateFlow(false)
    private var stoppedAt = 0L
    private var skip = false
    var now: () -> Long = { System.currentTimeMillis() }

    private fun active(): Boolean = try { Api.store.lockOn && Api.store.server != null } catch (_: Exception) { false }

    fun onColdStart() { if (active()) locked.value = true }
    fun onStop() { stoppedAt = now() }

    fun onStart() {
        if (skip) { skip = false; stoppedAt = 0; return }
        if (!active() || stoppedAt == 0L) return
        val away = now() - stoppedAt
        val after = Api.store.lockAfter.coerceAtLeast(0) * 1000L
        val need = if (after == 0L) 15_000L else after // 「每次」也给 15 秒，切一下别的 App 马上回来不用再验
        if (away >= need) locked.value = true
        stoppedAt = 0
    }

    /** 马上要打开 App 自己的别的界面（选文件、相机、安装…），回来不锁 */
    fun skipNext() { skip = true }
    fun unlocked() { locked.value = false; stoppedAt = 0 }

    fun unavailable(ctx: Context): String? = when (BiometricManager.from(ctx).canAuthenticate(AUTH)) {
        BiometricManager.BIOMETRIC_SUCCESS -> null
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> Tr.s(R.string.no_lock)
        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE, BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> Tr.s(R.string.bio_unavailable)
        BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> Tr.s(R.string.security_update)
        else -> Tr.s(R.string.bio_unsupported)
    }

    private const val GRACE_MS = 5 * 60_000L
    @Volatile private var verifiedAt = 0L
    /** 验证本人：5 分钟内验过直接过 */
    fun verify(activity: FragmentActivity, title: String, subtitle: String?, onOk: () -> Unit, onFail: (String?) -> Unit) {
        if (verifiedAt > 0 && now() - verifiedAt < GRACE_MS) { onOk(); return }
        prompt(activity, title, subtitle, onOk = { verifiedAt = now(); onOk() }, onFail = onFail)
    }

    /** 弹系统验证；成功 onOk，取消 onFail(null)，出错 onFail(原因) */
    fun prompt(activity: FragmentActivity, title: String, subtitle: String?, onOk: () -> Unit, onFail: (String?) -> Unit) {
        val p = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { onOk() }
            override fun onAuthenticationError(code: Int, msg: CharSequence) {
                onFail(if (code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON || code == BiometricPrompt.ERROR_CANCELED) null else msg.toString())
            }
        })
        val info = BiometricPrompt.PromptInfo.Builder().setTitle(title).apply { subtitle?.takeIf { it.isNotBlank() }?.let { setSubtitle(it) } }
            .setAllowedAuthenticators(AUTH).build()
        try { p.authenticate(info) } catch (e: Exception) { onFail(e.message ?: Tr.s(R.string.verify_failed)) }
    }
}
