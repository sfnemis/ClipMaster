# Test harness extension

Development only. Do not publish, do not install outside a throwaway virtual
machine.

GNOME Shell will not let an outside process take a screenshot or inject a key
press, and its own `Eval` method is switched off unless Looking Glass has
enabled unsafe mode. Without one of those, an extension's own user interface
cannot be driven from a test script at all: the functional layer can be checked
through the stored history, but the popup cannot.

This extension closes that gap by running inside the shell process and
forwarding a script there over the session bus. That makes it an arbitrary code
execution service for whoever can reach the session bus, which is the entire
reason it is kept out of the published package and removed again at the end of
a test run.

Install, use and remove:

    gnome-extensions pack --force -o /tmp scripts/test-harness/cmharness@test.local
    gnome-extensions install --force /tmp/cmharness@test.local.shell-extension.zip
    # a shell restart is needed before a newly installed extension can be enabled
    gnome-extensions enable cmharness@test.local
    bash scripts/live-ui-test.sh
    gnome-extensions uninstall cmharness@test.local
