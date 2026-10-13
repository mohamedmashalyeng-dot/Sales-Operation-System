import { BrowserRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import i18n from "./i18n";
import { AppRoutes } from "./router";
import { ToastProvider } from "@/components/base/Toast";
import { PreferencesProvider } from "@/hooks/useLocalPrefs";
import { WorkspaceProvider } from "@/store/WorkspaceProvider";

function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <BrowserRouter basename={__BASE_PATH__}>
        <WorkspaceProvider>
          <PreferencesProvider>
            <ToastProvider>
              <AppRoutes />
            </ToastProvider>
          </PreferencesProvider>
        </WorkspaceProvider>
      </BrowserRouter>
    </I18nextProvider>
  );
}

export default App;