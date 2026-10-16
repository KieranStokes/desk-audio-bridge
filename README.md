# Desk Audio Bridge

A small Windows tray utility for hearing your Xbox console through your PC's audio output while using Discord or other PC apps. Independent software, based on Greenlight by UnknownSKL (Jim Kroon) and contributors. Not affiliated with or endorsed by Microsoft.

## What it does

- Receives home Remote Play audio, with persistent volume, mute, and output selection.
- Starts in the tray after setup and waits for the selected console to be on; it does not wake the console.
- Keeps the physical controller paired directly to the console and forwards no controller input.
- Briefly attaches and immediately detaches the fourth remote-controller slot to satisfy the Xbox stream's startup handshake. A completely controller-free startup currently times out after roughly 60 seconds. Some games may still react to this handshake.

## Install and use

[Download the Windows installer and release notes](https://github.com/KieranStokes/desk-audio-bridge/releases/latest). This is an unsigned beta; Windows may show an Unknown Publisher or SmartScreen warning. Only install a copy you trust. Checksums are provided with each release.

Run the Desk Audio Bridge installer, sign in through Microsoft's website, and select your console. The password is entered only on Microsoft's site. Saved sign-in tokens are encrypted using Windows credential protection. Closing the window keeps audio running; use **Quit app** or the tray's **Quit** command to exit fully.

The application is compatible with Xbox One and Xbox Series consoles configured for Remote Play. Xbox must be powered on for an automatic connection. Each person uses their own Microsoft account; installers contain no account or console configuration.

## Development and distribution

Use Corepack and the pinned Yarn 1.22.22 version:

```powershell
corepack yarn install --frozen-lockfile
corepack yarn desktop dev
corepack yarn desktop build
corepack yarn workspace xbox-audio-bridge verify:release
```

The build generates the original icon and dependency notices and checks every packaged Node dependency against the license inventory. See [RELEASING.md](RELEASING.md) for verification and signing. Local unsigned builds may display Windows publisher warnings.

The internal application ID and profile/package name retain their earlier identifiers so existing installations upgrade without discarding sign-in or settings. The visible product, icon, tray, and installer use Desk Audio Bridge.

## License and attribution

This fork is distributed under the [MIT License](LICENSE). Greenlight's full copyright notice is retained. Dependency license text, version inventory, and supplementary notice provenance are included in the installer and accessible through **About & licenses**. Microsoft and Xbox are trademarks of the Microsoft group of companies.

<details>
<summary>Original upstream Greenlight README (historical reference)</summary>

# Greenlight

[![Build/Desktop](https://github.com/unknownskl/greenlight/actions/workflows/build_desktop.yml/badge.svg)](https://github.com/unknownskl/greenlight/actions/workflows/build_desktop.yml)
[![Build/Docs](https://github.com/unknownskl/greenlight/actions/workflows/build_docs.yml/badge.svg)](https://github.com/unknownskl/greenlight/actions/workflows/build_docs.yml)

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=unknownskl_greenlight&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=unknownskl_greenlight)
[![Lines of Code](https://sonarcloud.io/api/project_badges/measure?project=unknownskl_greenlight&metric=ncloc)](https://sonarcloud.io/summary/new_code?id=unknownskl_greenlight)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=unknownskl_greenlight&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=unknownskl_greenlight)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=unknownskl_greenlight&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=unknownskl_greenlight)

Greenlight is an open-source client for xCloud and Xbox home streaming made in Javascript and Typescript. The client is an application wrapper around [xbox-xcloud-player](https://github.com/unknownskl/xbox-xcloud-player).
The application runs on Linux, macOS, Windows and Steam Deck.

_DISCLAIMER: Greenlight is not affiliated with Microsoft, Xbox or Moonlight. All rights and trademarks are property of their respective owners._

## Features

- Stream video and audio from the Xbox One and Xbox Series
- Support for gamepad controls
- Supports rumble on xCloud
- Keyboard controls
- Build-in online friends list

<img src="images/main.png" width="400" /> <img src="images/stream.png" width="400" />

## Install

### Install from Flathub:
[Install on Flathub](https://flathub.org/apps/details/io.github.unknownskl.greenlight)

### Download pre-compiled binaries:
[Latest releases can be found here](https://github.com/unknownskl/greenlight/releases).

### Compile from source

See [Local development](?tab=readme-ov-file#local-development).

## Keyboard controls

Keys are mapped as following by default:

    Dpad: Keypad direction controls
    Buttons: A, B, X, Y, Backspace (Mapped as B), Enter (Mapped as A)
    Nexus (Xbox button): N
    Left Bumper: [
    Right Bumper: ]
    Left Trigger: -
    Right Trigger: =
    View: V
    Menu: M

## Streaming stats

During the stream you can show debug statistics that contain extra data about the buffer queues and other information. To bring this up you can press `~` on your keyboard.

At the bottom-left you can see the status (although not always accurate). At the top-right you can find the FPS of the video and audio decoders including the latency. At the bottom-right you can find debug information about the buffer queues and other information that is useful for debugging perposes.

When possible always provide this information with your issue, if it is related.

## Online friends list

The application also provides a way to see which of your friends are online. This can be useful when you want to quickly check if anyone is online to play with :)

## Steam Deck Setup

This application is reported to be working on the Steam Deck with some small bugs and side-effects. You can map one of the Steam Deck back buttons to the 'N' key to simulate the Xbox button.

## Optional launch arguments

| Argument | Description |
|----------|--------------|
| --fullscreen | Starts the application in fullscreen |
| --connect=<value> | Will start stream once the user is authenticated. |

For console use `F000000000000000` format and for xCloud use `xcloud_<title>`.

## To close the application

Click on the Xbox logo at the top-left. It will ask you to confirm to close the window.

## Local Development

### Requirements

- NodeJS ([https://nodejs.org/](https://nodejs.org/))
- Yarn ([https://yarnpkg.com/](https://yarnpkg.com/))

### Steps to get up and running

Clone the repository:

    git clone https://github.com/unknownskl/greenlight.git
    cd greenlight

Install dependencies:

    yarn

Run development build:

    yarn desktop dev

Create production build:

    yarn desktop build

## Translations

Want to help out with new translations? Help us on [https://poeditor.com/join/project/9SfHRQDbfN](Poeditor.com)

## Changelog

See [changelog](https://unknownskl.github.io/greenlight/docs/desktop/changelog).

</details>
