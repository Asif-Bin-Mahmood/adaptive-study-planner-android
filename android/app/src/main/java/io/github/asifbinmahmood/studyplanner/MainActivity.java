package io.github.asifbinmahmood.studyplanner;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyTextZoom();
    }

    @Override
    public void onResume() {
        super.onResume();
        applyTextZoom();
    }

    /** Follow the Android font-size setting, so the rem-based layout scales with it. */
    private void applyTextZoom() {
        if (bridge == null || bridge.getWebView() == null) return;
        WebSettings settings = bridge.getWebView().getSettings();
        float scale = getResources().getConfiguration().fontScale;
        settings.setTextZoom(Math.round(scale * 100));
    }
}
