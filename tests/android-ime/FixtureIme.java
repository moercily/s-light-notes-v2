package com.slightnotes.qa.ime;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.inputmethodservice.InputMethodService;
import android.os.Build;
import android.util.Base64;
import android.view.inputmethod.InputConnection;
import java.nio.charset.StandardCharsets;

/** Installed only inside the owned disposable AVD. Never ship this in the product. */
public final class FixtureIme extends InputMethodService {
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            InputConnection input = getCurrentInputConnection();
            if (input == null) { setResultCode(Activity.RESULT_CANCELED); return; }
            String mode = intent.getStringExtra("mode");
            String encoded = intent.getStringExtra("payload");
            String text = encoded == null ? "" : new String(Base64.decode(encoded, Base64.DEFAULT), StandardCharsets.UTF_8);
            boolean result;
            if ("compose".equals(mode)) result = input.setComposingText(text, 1);
            else if ("finish".equals(mode)) result = input.finishComposingText();
            else result = input.commitText(text, 1);
            setResultCode(result ? Activity.RESULT_OK : Activity.RESULT_CANCELED);
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        IntentFilter filter = new IntentFilter("com.slightnotes.qa.ime.INPUT");
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        else registerReceiver(receiver, filter);
    }

    @Override public void onDestroy() {
        unregisterReceiver(receiver);
        super.onDestroy();
    }
}
