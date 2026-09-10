# Installing Settle 0.2.2

## macOS

1. Unzip the download.
2. Double-click install-mac.command.
3. If macOS blocks it, Control-click the installer, choose Open, then Open
   again.
4. Completely quit After Effects with Cmd+Q.
5. Reopen After Effects.
6. Open **Window > Extensions > Settle**. Some builds label the menu
   **Extensions (Legacy)**.

The installer copies the complete settle folder into:

    ~/Library/Application Support/Adobe/CEP/extensions/

It also enables unsigned CEP panels for CSXS 9 through 12 and removes the
download quarantine flag from the installed extension.

## Windows

1. Unzip the download.
2. Double-click install-windows.bat.
3. If SmartScreen appears, choose More info, then Run anyway.
4. Completely quit and reopen After Effects.
5. Open **Window > Extensions > Settle** or **Extensions (Legacy) > Settle**.

The installer copies the extension into:

    %APPDATA%\Adobe\CEP\extensions\settle

## Updating

Run the installer again. It replaces the previous Settle folder while leaving
other Adobe extensions untouched. Body assignments are stored in the After
Effects project, so updating the panel does not remove them.

## Removing

Run uninstall-mac.command or uninstall-windows.bat.

## If Settle does not appear

1. Confirm the installed file exists:

       settle/CSXS/manifest.xml

2. Validate that the whole settle folder, rather than an extra nested wrapper,
   is inside the CEP extensions directory.
3. Quit After Effects fully and reopen it.
4. On macOS, inspect:

       ~/Library/Logs/CSXS/CEP12-AEFT.log

   Search for settle, XPATH, or extension errors.

## Signed ZXP release

The included build-zxp.js can produce a self-signed ZXP:

    npm install

On macOS or Linux, choose a private certificate password for the current shell:

    SETTLE_CERT_PASSWORD='choose-a-private-password' npm run zxp

On Windows PowerShell:

    $env:SETTLE_CERT_PASSWORD='choose-a-private-password'
    npm run zxp

The output is dist/Settle_0.2.2.zxp. Keep cert.p12 safe and reuse it for future
updates. Never commit cert.p12 or the certificate password.
