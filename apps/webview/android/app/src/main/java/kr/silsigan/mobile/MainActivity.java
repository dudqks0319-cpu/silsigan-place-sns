package kr.silsigan.mobile;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    public MainActivity() {
        registerPlugin(SilsiganShellPlugin.class);
    }
}
