; Installs the signed vendor client alongside HayDev on request.
; Silent installations opt in with /INSTALLPROTONVPN.
LangString Proton_offer 1033 "Install Proton VPN Free alongside HayDev Browser?$\r$\n$\r$\nSetup downloads the official Windows client and may ask for administrator approval. Sign in to Proton VPN to connect."
LangString Proton_offer 1049 "Установить Proton VPN Free вместе с HayDev Browser?$\r$\n$\r$\nМастер скачает официальный клиент. Windows может запросить права администратора. Для подключения войдите в Proton VPN."
LangString Proton_progress 1033 "Downloading and installing Proton VPN Free. Windows may ask for administrator approval."
LangString Proton_progress 1049 "Скачиваем и устанавливаем Proton VPN Free. Windows может запросить права администратора."
LangString Proton_done 1033 "Proton VPN is installed."
LangString Proton_done 1049 "Proton VPN установлен."
LangString Proton_reboot 1033 "Restart Windows to finish Proton VPN setup."
LangString Proton_reboot 1049 "Перезапустите Windows, чтобы завершить установку Proton VPN."
LangString Proton_failed 1033 "Proton VPN setup did not complete. You can retry from the Proton VPN panel in HayDev Browser."
LangString Proton_failed 1049 "Установка Proton VPN не завершилась. Повторить её можно из панели Proton VPN в HayDev Browser."
LangString Proton_cancelled 1033 "Proton VPN setup was cancelled. You can install it from HayDev Browser later."
LangString Proton_cancelled 1049 "Установка Proton VPN отменена. Позже её можно запустить из HayDev Browser."

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  ${If} $UpdateMode = 1
    Goto proton_setup_done
  ${EndIf}
  ${GetOptions} $CMDLINE "/INSTALLPROTONVPN" $0
  ${If} ${Errors}
    ${If} ${Silent}
    ${OrIf} $PassiveMode = 1
      Goto proton_setup_done
    ${EndIf}
    ClearErrors
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --proton-vpn-installed' $0
    ${IfNot} ${Errors}
    ${AndIf} $0 = 0
      Goto proton_setup_done
    ${EndIf}
    MessageBox MB_YESNO|MB_ICONQUESTION "$(Proton_offer)" /SD IDNO IDNO proton_setup_done
  ${EndIf}

  DetailPrint "$(Proton_progress)"
  ClearErrors
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --install-proton-vpn' $0
  ${If} ${Errors}
    StrCpy $0 1
  ${EndIf}
  ${If} $0 = 0
    DetailPrint "$(Proton_done)"
  ${ElseIf} $0 = 3
    DetailPrint "$(Proton_reboot)"
    MessageBox MB_OK|MB_ICONINFORMATION "$(Proton_reboot)" /SD IDOK
    SetErrorLevel 3010
  ${Else}
    ${If} $0 = 2
      DetailPrint "$(Proton_cancelled)"
      MessageBox MB_OK|MB_ICONINFORMATION "$(Proton_cancelled)" /SD IDOK
    ${Else}
      DetailPrint "$(Proton_failed)"
      MessageBox MB_OK|MB_ICONINFORMATION "$(Proton_failed)" /SD IDOK
    ${EndIf}
    ${If} ${Silent}
      SetErrorLevel $0
    ${EndIf}
  ${EndIf}
proton_setup_done:
  Pop $0
!macroend
