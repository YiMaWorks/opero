# 网页调外壳的接口（window.OperoNative）：方法名不能被混淆
-keepclassmembers class cn.yimakeji.opero.web.** {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**
