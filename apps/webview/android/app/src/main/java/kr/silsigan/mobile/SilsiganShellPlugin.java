package kr.silsigan.mobile;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name = "SilsiganShell")
public class SilsiganShellPlugin extends Plugin {
    private static final Set<String> ALLOWED_SECTIONS = new HashSet<>(Arrays.asList(
            "app", "location", "camera", "notifications"
    ));

    @PluginMethod
    public void openSettings(PluginCall call) {
        String section = call.getString("section", "");
        if (!ALLOWED_SECTIONS.contains(section)) {
            call.reject("Unsupported settings section", "INVALID_SECTION");
            return;
        }

        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("Unable to open app settings", "SETTINGS_UNAVAILABLE");
        }
    }
}
