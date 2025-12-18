"use strict";

// ============================================================
// UI HELPERS (sliders → re-render)
// ============================================================

// Attach the same onchange callback to all lighting sliders.
// Whenever any value changes, we trigger a re-render.
function setupInputListeners(onchange) {
    document.getElementById('emitted-radiance').oninput = onchange; // L_e
    document.getElementById('ambient-radiance').oninput = onchange; // L_a
    document.getElementById('diffuse').oninput = onchange;          // k_d
    document.getElementById('specular').oninput = onchange;         // k_s
    document.getElementById('shininess').oninput = onchange;        // s
}

// Read UI slider values and return them as floats.
// These map directly to the Phong lighting parameters used in WGSL.
function getOptions() {
    const emittedRadianceSlider = document.getElementById('emitted-radiance');
    const ambientRadianceSlider = document.getElementById('ambient-radiance');
    const diffuseSlider = document.getElementById('diffuse');
    const specularSlider = document.getElementById('specular');
    const shininessSlider = document.getElementById('shininess');

    return {
        emittedRadiance: parseFloat(emittedRadianceSlider.value), // L_e
        ambientRadiance: parseFloat(ambientRadianceSlider.value), // L_a
        diffuse: parseFloat(diffuseSlider.value),                 // k_d
        specular: parseFloat(specularSlider.value),               // k_s
        shininess: parseFloat(shininessSlider.value),             // s
    };
}


async function main() {
    // ============================================================
    // WEBGPU INIT
    // ============================================================
    // Request adapter/device, configure the canvas context.
    const gpu = navigator.gpu;
    const adapter = await gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.getElementById('my-canvas');
    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: canvasFormat,
    });

    // ============================================================
    // GEOMETRY: load OBJ mesh (Suzanne)
    // ============================================================
    // OBJ provides: vertices (vec4), colors (vec4), normals (vec4), indices (u32)
    // NOTE: Path is relative to this part folder.
    const obj_filename = "../assets/suzanne.obj";
    const obj = await readOBJFile(obj_filename, 1.0, true);

    // --------------------------
    // Position buffer (location=0)
    // --------------------------
    const positions = obj.vertices;
    const positionBuffer = device.createBuffer({
        size: sizeof['vec4'] * positions.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const positionBufferLayout = {
        arrayStride: sizeof['vec4'],
        attributes: [{
            format: 'float32x4',
            offset: 0,
            shaderLocation: 0,
        }],
    };
    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));

    // --------------------------
    // Color buffer (location=1)
    // --------------------------
    // Used as base color / diffuse base in shader (depending on WGSL).
    const colors = obj.colors;
    const colorBuffer = device.createBuffer({
        size: sizeof['vec4'] * colors.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const colorBufferLayout = {
        arrayStride: sizeof['vec4'],
        attributes: [{
            format: 'float32x4',
            offset: 0,
            shaderLocation: 1,
        }],
    };
    device.queue.writeBuffer(colorBuffer, 0, flatten(colors));

    // --------------------------
    // Normal buffer (location=2)
    // --------------------------
    // Used for lighting (Lambert/Phong): normals should be normalized in shader.
    const normals = obj.normals;
    const normalBuffer = device.createBuffer({
        size: sizeof['vec4'] * normals.length,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const normalBufferLayout = {
        arrayStride: sizeof['vec4'],
        attributes: [{
            format: 'float32x4',
            offset: 0,
            shaderLocation: 2,
        }],
    };
    device.queue.writeBuffer(normalBuffer, 0, flatten(normals));

    // --------------------------
    // Index buffer
    // --------------------------
    // Triangle-list indices for indexed rendering.
    const indices = obj.indices;
    const indicesBuffer = device.createBuffer({
        size: sizeof['vec4'] * indices.length,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indicesBuffer, 0, indices);

    // ============================================================
    // UNIFORM BUFFER LAYOUT (matches WGSL Uniforms struct)
    // ============================================================
    // We pack:
    //   [eye.xyz, emittedRadiance, ambientRadiance, diffuse, specular, shininess]  -> 8 floats
    //   [mvp mat4]                                                               -> 16 floats
    // Total = 8*4 bytes + 16*4 bytes = 96 bytes (plus alignment handled by offsets)
    const uniformBuffer = device.createBuffer({
        size: 4 * 8 + sizeof['mat4'],
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Background color (cornflower blue)
    const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0);

    // ============================================================
    // CAMERA / TRANSFORMS
    // ============================================================
    // Mst: WebGPU depth fix (maps clip-space z from [-1,1] to [0,1])
    const Mst = mat4(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
    );

    // Model transform for the mesh (position it nicely in the view)
    const M = mult(translate(0, -0.5, 0), scalem(0.8, 0.8, 0.8));

    // Perspective projection (then depth fix)
    let projection = perspective(45, canvas.width / canvas.height, 0.1, 100);
    projection = mult(Mst, projection);

    // ============================================================
    // SHADERS + PIPELINE
    // ============================================================
    // WGSL is loaded from the <script id="wgsl" src="..."> tag.
    const wgslfile = document.getElementById('wgsl').src;
    const wgslcode = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({ code: wgslcode });

    const msaaCount = 4;

    // Render pipeline:
    // - main_vs / main_fs are the entry points
    // - back-face culling enabled
    // - MSAA + depth testing enabled for correct 3D rendering
    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs',
            buffers: [positionBufferLayout, colorBufferLayout, normalBufferLayout],
        },
        fragment: {
            module: wgsl,
            entryPoint: 'main_fs',
            targets: [{ format: canvasFormat }],
        },
        primitive: {
            topology: 'triangle-list',
            frontFace: 'ccw',
            cullMode: 'back'
        },
        multisample: { count: msaaCount },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus',
        },
    });

    // ============================================================
    // MSAA + DEPTH ATTACHMENTS
    // ============================================================
    // Render to MSAA texture then resolve to the swapchain texture.
    const msaaTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: canvasFormat,
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // Depth buffer (also MSAA to match render target sample count)
    const depthTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: 'depth24plus',
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // ============================================================
    // BIND GROUP (uniforms)
    // ============================================================
    // binding(0) in WGSL = uniform buffer.
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{
            binding: 0,
            resource: { buffer: uniformBuffer }
        }],
    });

    // ============================================================
    // ORBIT CAMERA VIA MOUSE DRAG (Euler angles)
    // ============================================================
    // thetax/thetay: rotation angles (degrees) controlling orbit
    // angularSpeed : sensitivity (bigger = faster rotation)
    let thetax = 0;
    let thetay = 0;
    let angularSpeed = 0.5;

    // Last mouse position (canvas-local pixels)
    let x0 = 0;
    let y0 = 0;

    // Drag flag
    let isDragging = false;

    // ------------------------------------------------------------
    // Touch support: convert touch gestures into mouse events.
    // This lets mobile users drag/rotate the model using touch.
    // ------------------------------------------------------------
    canvas.addEventListener("touchstart", function (event) {
        event.preventDefault();
        if (event.targetTouches.length === 1) {
            var touch = event.targetTouches[0];
            canvas.dispatchEvent(new MouseEvent("mousedown",
                {
                    button: 0, bubbles: true, cancelable: true,
                    clientX: touch.clientX, clientY: touch.clientY
                }));
            this.addEventListener("touchmove", roll, false);
            this.addEventListener("touchend", release, false);
            function roll(e) {
                touch = e.targetTouches[0];
                canvas.dispatchEvent(new MouseEvent("mousemove",
                    { bubbles: true, cancelable: true, clientX: touch.clientX, clientY: touch.clientY }));
            }
            function release() {
                canvas.dispatchEvent(new MouseEvent("mouseup",
                    { bubbles: true, cancelable: true, clientX: touch.clientX, clientY: touch.clientY }));
                this.removeEventListener("touchmove", roll);
                this.removeEventListener("touchend", release);
            }
        }
    });

    // ------------------------------------------------------------
    // Mouse: press to start dragging
    // ------------------------------------------------------------
    canvas.addEventListener("mousedown", function (event) {
        // Convert client coords → canvas-local coords
        const rect = canvas.getBoundingClientRect();
        x0 = event.clientX - rect.left;
        y0 = event.clientY - rect.top;
        isDragging = true;
    });

    // ------------------------------------------------------------
    // Mouse: drag to update angles (orbit camera)
    // dx controls yaw (left/right), dy controls pitch (up/down)
    // ------------------------------------------------------------
    canvas.addEventListener("mousemove", function (event) {
        if (!isDragging) return;
        event.preventDefault();

        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        const dx = x - x0;
        const dy = y - y0;

        // Update orbit angles
        thetax += dy * angularSpeed; // pitch
        thetay += dx * angularSpeed; // yaw

        // Update last position
        x0 = x;
        y0 = y;

        // Trigger a new frame (only when interacting)
        requestAnimationFrame(render);
    });

    // Stop drag on mouse up / leaving canvas
    canvas.addEventListener("mouseup", function (event) {
        isDragging = false;
    });

    canvas.addEventListener("mouseleave", function (event) {
        isDragging = false;
    });

    // ============================================================
    // RENDER LOOP (on-demand)
    // ============================================================
    function render() {
        // --------------------------------------------------------
        // Read lighting parameters from the UI
        // --------------------------------------------------------
        // emittedRadiance = L_e (strength of the direct light)
        // ambientRadiance = L_a (base ambient term)
        // diffuse         = k_d (Lambert diffuse reflectance)
        // specular        = k_s (Phong specular reflectance)
        // shininess       = s   (Phong exponent; higher = tighter highlight)
        const {
            emittedRadiance,
            ambientRadiance,
            diffuse,
            specular,
            shininess
        } = getOptions();

        // --------------------------------------------------------
        // Orbit camera setup
        // --------------------------------------------------------
        // Start with eye on +z axis at distance r,
        // then rotate that eye vector by Rx, Ry to orbit around the origin.
        const r = 4;
        let eye = vec4(0, 0, r, 1);

        let Rx = rotateX(thetax);
        let Ry = rotateY(thetay);

        // Rotate the eye position around the center (orbit)
        eye = mult(Rx, mult(Ry, eye));

        // View matrix: look from eye → origin, with +Y as up
        const V = lookAt(vec3(eye[0], eye[1], eye[2]), vec3(0, 0, 0), vec3(0, 1, 0));

        // MVP for transforming model vertices into clip space
        const mvp = mult(projection, mult(V, M));

        // --------------------------------------------------------
        // Upload uniforms to GPU
        // --------------------------------------------------------
        // Uniform packing (must match WGSL):
        // [ eye.xyz, L_e, L_a, k_d, k_s, s ] then [ mvp ]
        const uniformFloats = new Float32Array([
            ...flatten(vec3(eye[0], eye[1], eye[2])), // eye position (world/camera space assumption in shader)
            emittedRadiance,                          // L_e
            ambientRadiance,                          // L_a
            diffuse,                                  // k_d
            specular,                                 // k_s
            shininess,                                // s
        ]);
        device.queue.writeBuffer(uniformBuffer, 0, uniformFloats);
        device.queue.writeBuffer(uniformBuffer, 4 * 8, flatten(mvp));

        // --------------------------------------------------------
        // Record commands
        // --------------------------------------------------------
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: msaaTexture.createView(),
                resolveTarget: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: bgcolor[0], g: bgcolor[1], b: bgcolor[2], a: bgcolor[3] },
            }],
            depthStencilAttachment: {
                view: depthTexture.createView(),
                depthLoadOp: "clear",
                depthClearValue: 1.0,
                depthStoreOp: "store",
            }
        });

        // Bind pipeline + buffers + uniforms and draw indexed triangles
        pass.setPipeline(pipeline);
        pass.setIndexBuffer(indicesBuffer, 'uint32');
        pass.setVertexBuffer(0, positionBuffer);
        pass.setVertexBuffer(1, colorBuffer);
        pass.setVertexBuffer(2, normalBuffer);
        pass.setBindGroup(0, bindGroup);
        pass.drawIndexed(indices.length);

        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    // Re-render whenever sliders change
    setupInputListeners(() => { requestAnimationFrame(render); });

    // Initial frame
    render();
}

window.onload = function () { main(); }
