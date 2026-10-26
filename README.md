# Potential Well Strategy

Potential Well Strategy (PWS) is an experimental project that studies whether the same device can
be recognized when it uses different web browsers.

Web browsers do not provide a permanent hardware ID. They expose a limited set of details about the
device, and each browser may report those details differently. PWS collects several small signals
and compares them as a group instead of expecting one value to identify the device.

## Purpose

PWS creates device profiles for research, testing, and risk analysis. It can help answer questions
such as:

- Does this observation look similar to one seen before?
- How much information was available for the comparison?
- How confident is the system that two observations came from the same device?

PWS does **not** create a guaranteed hardware serial number. Its results must not be used as proof
of identity or as a replacement for passwords, passkeys, or other authentication methods.

## How a fingerprint is created

1. **The user starts the probe.**  
   PWS runs a set of small tests in the browser.

2. **The browser collects signals.**  
   These signals can include graphics capabilities, processor and memory estimates, timing
   measurements, canvas and audio output, and basic browser information. The synthetic fractal runs
   on WebGPU when available and falls back to CPU workers in other browsers.

3. **The signals are cleaned and normalized.**  
   Browser-specific wording is simplified where possible. For example, different graphics renderer
   descriptions may be reduced to a common vendor and model.

4. **A browser profile ID is created.**  
   Exact browser-visible values are combined and hashed. This ID is useful for checking whether the
   same browser produces a repeatable result. It is not expected to match another browser.

5. **A device observation is sent to the server.**  
   The observation contains the normalized signals used for device matching. Browser-specific
   values such as canvas, audio, screen size, and the browser profile ID are not used as strong
   device-matching signals.

6. **The server compares the observation with stored profiles.**  
   Each available signal receives a weight. Missing signals are skipped, so a browser without
   WebGPU can still be compared with other observations.

7. **The server returns a device cluster ID.**  
   If the observation is similar enough to an existing cluster, the existing ID is returned.
   Otherwise, the server creates a new random ID.

## Results

PWS displays:

- **Browser profile ID:** an exact hash for the current browser profile.
- **Device cluster ID:** a server-created ID for a group of similar observations.
- **Confidence:** how closely the new observation matched the selected cluster.
- **Evidence:** how much comparable signal data was available.

A high confidence score means the observations are similar. It does not prove that they came from
the same physical device.

## Signals used

PWS may collect:

- WebGL graphics vendor, renderer, limits, precision, output, and timing
- WebGPU adapter details, numerical output, limits, and timing
- Processor, floating-point, and memory workload timing ratios
- Browser-reported processor core and memory estimates
- A Mandelbrot fractal calculation grid produced by WebGPU or CPU workers
- Canvas and optional offline-audio output
- Browser, platform, and display information

Some browsers hide or reduce these values to protect user privacy. Each optional probe can fail
without stopping the remaining probes.

## Mandelbrot fractal probe

PWS uses the **Mandelbrot set algorithm**. For every point in the grid, it repeats the Mandelbrot
calculation up to 100 times.

PWS calculates each point in two ways:

- A normal floating-point calculation
- A calculation with values rounded into larger steps

It measures how far the two results move apart. The average of those differences is shown as
**Average Synthetic Delta**. A value greater than zero is expected and does not mean that the GPU
is damaged.

WebGPU runs the fractal when it is available. Browsers without WebGPU use CPU workers instead.

During one optional stability test, the cold samples, load passes, loaded samples, and recovery
samples use the same WebGPU device and compute pipeline. This gives the test a consistent GPU
session. The browser still controls its internal GPU process and may restart it after an error.
Starting a new device-profile probe creates a new WebGPU session.

The fractal is useful for studying:

- Whether the same calculation produces the same output repeatedly
- How execution time changes while the GPU is under load
- Whether performance returns after a short cooldown
- Timing variation, changed pixels, and WebGPU device loss
- Differences between browsers, drivers, and graphics APIs

The most useful results are the changed-pixel percentage, timing variation, slowdown under load,
and recovery. The average synthetic delta alone is not a hardware fingerprint.

## Optional GPU stability test

The interface can run an additional bounded WebGPU load and recovery test. It:

1. Captures a cold fractal sample.
2. Repeats the fractal workload for a short, limited period.
3. Captures samples while the GPU is loaded.
4. Waits briefly and captures recovery samples.
5. Reports changed pixels and timing variation.

This test stops if it is cancelled or the page becomes hidden. Its results are shown separately and
are not used for device-cluster matching. A changed result can be caused by the browser, graphics
driver, temperature, power settings, or other system activity. It does not prove that the hardware
is damaged.

## Important limitations

- Different browsers may report the same hardware differently.
- Browser privacy features may hide, reduce, or change signals.
- Software and operating-system updates can change a profile.
- Two devices with the same model and configuration may look alike.
- Timing measurements can change because of temperature, power settings, background work, or
  system load.
- Fingerprints can be copied or spoofed.

For these reasons, PWS uses similarity matching and confidence scores instead of claiming to
produce an exact hardware ID.

## Development

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful commands:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

The application requires a Node.js server. It cannot be deployed as a GitHub Pages static export.

## Storage and deployment

By default, the server stores device clusters in:

```text
.pws-data/device-clusters.json
```

This file-based storage is intended for one self-hosted Node.js process with persistent disk
storage. A serverless or multi-server production deployment needs a shared transactional database.

Configuration:

- `PWS_DATA_PATH`: location of the JSON data file
- `PWS_MAX_DEVICE_CLUSTERS`: maximum number of stored clusters; default is `10000`
- `PWS_BASE_PATH`: URL path used to host the application; production default is `/pws`

PWS does not use a third-party fingerprinting or matching library.

## Privacy

Device fingerprinting can affect user privacy. Before using PWS:

- Clearly explain what data is collected and why.
- Obtain appropriate user consent.
- Limit access to stored observations.
- Define how long data is kept.
- Provide a process for deleting stored data.
- Never treat a device cluster ID as proof of a person's identity.
