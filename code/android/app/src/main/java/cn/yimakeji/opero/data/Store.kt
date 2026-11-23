package cn.yimakeji.opero.data

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 本机保存（照 KidLock data/Store.kt）：连的是哪套 Opero、这台手机的设备令牌（系统密钥库加密后再存）、推送取到哪了、解锁设置。
 * 一人一套：没有账号密码，配对时拿到一个设备令牌，网页里「我 → 账号安全 → 手机」能随时作废。
 */
class Store(ctx: Context) {
    private val sp: SharedPreferences = ctx.getSharedPreferences("opero", Context.MODE_PRIVATE)

    /** 自己那套 Opero 的地址（https://…，没有结尾的 /）；null = 还没连 */
    var server: String?
        get() = sp.getString("server", null)
        set(v) { sp.edit().apply { if (v == null) remove("server") else putString("server", v.trim().trimEnd('/')) }.apply() }

    /** 配对拿到的设备令牌；null = 没配对（只打开网页、收不到推送） */
    var deviceToken: String?
        get() = sp.getString("dt", null)?.let { Crypto.open(it) }
        set(v) { sp.edit().apply { if (v == null) remove("dt") else putString("dt", Crypto.seal(v)) }.commit() }

    val deviceId: String
        get() = sp.getString("device_id", null) ?: UUID.randomUUID().toString().also { sp.edit().putString("device_id", it).apply() }

    /** 推送取到第几条了（-1 = 从现在开始） */
    var pushLast: Long
        get() = sp.getLong("push_last", -1)
        set(v) { sp.edit().putLong("push_last", v).apply() }

    var pushEnabled: Boolean
        get() = sp.getBoolean("push_on", true)
        set(v) { sp.edit().putBoolean("push_on", v).apply() }

    /** 严重告警一直响到点开 */
    var insistent: Boolean
        get() = sp.getBoolean("insistent", true)
        set(v) { sp.edit().putBoolean("insistent", v).apply() }

    /** 指纹解锁 App；离开多少秒后回来要解锁（0 = 每次，15 秒内回来不算） */
    var lockOn: Boolean
        get() = sp.getBoolean("lock_on", false)
        set(v) { sp.edit().putBoolean("lock_on", v).apply() }
    var lockAfter: Int
        get() = sp.getInt("lock_after", 60)
        set(v) { sp.edit().putInt("lock_after", v).apply() }

    /** 网页上次是深色还是浅色（打开时状态栏先用它，不闪） */
    var dark: Boolean
        get() = sp.getBoolean("dark", false)
        set(v) { sp.edit().putBoolean("dark", v).apply() }

    fun clearPairing() {
        deviceToken = null
        pushLast = -1
    }
}

/** 令牌用 Android 系统密钥库（AES/GCM）加密后再存（同 KidLock） */
object Crypto {
    private const val ALIAS = "opero_store_v1"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return gen.generateKey()
    }

    fun seal(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val out = c.iv + c.doFinal(plain.toByteArray())
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    /** 解不开（换机恢复、密钥库被清）就当没有 */
    fun open(sealed: String): String? = try {
        val raw = Base64.decode(sealed, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, 12))
        String(c.doFinal(raw, 12, raw.size - 12))
    } catch (_: Exception) { null }
}
