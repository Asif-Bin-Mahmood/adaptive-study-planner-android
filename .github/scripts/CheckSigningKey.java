import java.io.File;
import java.security.KeyStore;

// Checks that the release keystore opens with the configured secrets before Gradle runs.
// Prints only yes/no results, never a password, alias or key material.
// Usage: java CheckSigningKey.java <keystore file>, with the passwords and alias in env.
public class CheckSigningKey {
    static String yn(boolean b) {
        return b ? "yes" : "no";
    }

    static boolean printableAscii(String s) {
        return s.chars().allMatch(c -> c >= 0x20 && c <= 0x7e);
    }

    static boolean noSurroundingSpace(String s) {
        return s.equals(s.strip());
    }

    static boolean keyOpens(KeyStore ks, String alias, String password) {
        try {
            return ks.getKey(alias, password.toCharArray()) != null;
        } catch (Exception e) {
            return false;
        }
    }

    public static void main(String[] args) {
        String storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD");
        String alias = System.getenv("ANDROID_KEY_ALIAS");
        String keyPassword = System.getenv("ANDROID_KEY_PASSWORD");

        System.out.println("ANDROID_KEYSTORE_PASSWORD: printable ASCII only=" + yn(printableAscii(storePassword))
                + ", no leading/trailing whitespace=" + yn(noSurroundingSpace(storePassword)));
        System.out.println("ANDROID_KEY_ALIAS: no leading/trailing whitespace=" + yn(noSurroundingSpace(alias)));
        System.out.println("ANDROID_KEY_PASSWORD: printable ASCII only=" + yn(printableAscii(keyPassword))
                + ", no leading/trailing whitespace=" + yn(noSurroundingSpace(keyPassword))
                + ", same as ANDROID_KEYSTORE_PASSWORD=" + yn(keyPassword.equals(storePassword)));

        KeyStore ks;
        try {
            ks = KeyStore.getInstance(new File(args[0]), storePassword.toCharArray());
        } catch (Exception e) {
            System.out.println("::error::The keystore does not open with ANDROID_KEYSTORE_PASSWORD ("
                    + e.getClass().getSimpleName() + "). Check that secret and ANDROID_KEYSTORE_BASE64.");
            System.exit(1);
            return;
        }
        System.out.println("Keystore opens with ANDROID_KEYSTORE_PASSWORD: yes (type " + ks.getType() + ")");

        boolean hasKey;
        try {
            hasKey = ks.isKeyEntry(alias);
        } catch (Exception e) {
            hasKey = false;
        }
        System.out.println("Private key found under ANDROID_KEY_ALIAS: " + yn(hasKey));
        if (!hasKey) {
            System.out.println("::error::No private key under ANDROID_KEY_ALIAS. Set it to the -alias used with keytool.");
            System.exit(1);
        }

        boolean withKeyPassword = keyOpens(ks, alias, keyPassword);
        System.out.println("Key opens with ANDROID_KEY_PASSWORD: " + yn(withKeyPassword));
        if (!withKeyPassword) {
            System.out.println("Key opens with ANDROID_KEYSTORE_PASSWORD: " + yn(keyOpens(ks, alias, storePassword)));
            System.out.println("::error::The key does not open with ANDROID_KEY_PASSWORD. For a PKCS12 keystore it must"
                    + " be the keystore password, typed exactly, with no extra spaces or line breaks.");
            System.exit(1);
        }
    }
}
