"use strict";

function setupInputListeners(onchange) {
    document.getElementById('emitted-radiance').oninput = onchange;
    document.getElementById('ambient-radiance').oninput = onchange;
    document.getElementById('diffuse').oninput = onchange;
    document.getElementById('specular').oninput = onchange;
    document.getElementById('shininess').oninput = onchange;
    // Camera mode change doesn't need re-render immediately, but good to have listener
    document.getElementById('camera-mode').onchange = () => {}; 
}

function getOptions() {
    const emittedRadianceSlider = document.getElementById('emitted-radiance');
    const ambientRadianceSlider = document.getElementById('ambient-radiance');
    const diffuseSlider = document.getElementById('diffuse');
    const specularSlider = document.getElementById('specular');
    const shininessSlider = document.getElementById('shininess');

    return {
        emittedRadiance: parseFloat(emittedRadianceSlider.value),
        ambientRadiance: parseFloat(ambientRadianceSlider.value),
        diffuse: parseFloat(diffuseSlider.value),
        specular: parseFloat(specularSlider.value),
        shininess: parseFloat(shininessSlider.value),
    };
}

function getCameraMode() {
    const cameraModeSelect = document.getElementById('camera-mode');
    return cameraModeSelect.value ?? 'orbit';
}

async function main() {
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

    // CORRECTED PATH: ../assets/suzanne.obj
    const obj_filename = "../assets/suzanne.obj";
    const obj = await readOBJFile(obj_filename, 1.0, true);

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

    const indices = obj.indices;
    const indicesBuffer = device.createBuffer({
        size: sizeof['vec4'] * indices.length,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indicesBuffer, 0, indices);

    const uniformBuffer = device.createBuffer({
        size: 4 * 8 + sizeof['mat4'],
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0) // Cornflower

    const Mst = mat4(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
    )

    const M = mult(translate(0, -0.5, 0), scalem(0.8, 0.8, 0.8));

    let projection = perspective(45, canvas.width / canvas.height, 0.1, 100);
    projection = mult(Mst, projection);

    const wgslfile = document.getElementById('wgsl').src;
    const wgslcode = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({
        code: wgslcode
    });

    const msaaCount = 4;

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


    const msaaTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: canvasFormat,
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const depthTexture = device.createTexture({
        size: { width: canvas.width, height: canvas.height },
        format: 'depth24plus',
        sampleCount: msaaCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{
            binding: 0,
            resource: { buffer: uniformBuffer }
        }],
    });


    // --- Camera State ---
    let zEye = 4;
    let xpan = 0;
    let ypan = 0;
    const at = vec3(0, 0, 0);
    const up = vec3(0, 1, 0);
    const z = subtract(vec3(0, 0, zEye), at); // Initial look vector

    let y_last;
    let x_last;
    const dollySpeed = 0.01;
    const panSpeed = 0.01;

    let u_last;
    let q_rot = new Quaternion();
    q_rot = q_rot.make_rot_vec2vec(vec3(0, 0, 1), normalize(z));
    let q_inc = new Quaternion();

    let isDragging = false;

    // --- Touch Support ---
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

    function mapEventCoordsToSphere(event) {
        const rect = event.target.getBoundingClientRect();
        // Map to -1 to 1
        const px = 2 * (event.clientX - rect.left) / canvas.width - 1;
        const py = 2 * (canvas.height - (event.clientY - rect.top)) / canvas.height - 1; // Flip Y properly
        return normalize(orthographicHyperbolicMapping(px, py));
    }

    function orthographicHyperbolicMapping(px, py) {
        const d = Math.sqrt(px * px + py * py);
        if (d < 1.0 / Math.SQRT2) {
            return vec3(px, py, Math.sqrt(1.0 - d * d));
        } else {
            return vec3(px, py, 1.0 / (2.0 * d));
        }
    }

    // Mouse event handlers
    canvas.addEventListener("mousedown", function (event) {
        // event.preventDefault(); // Don't prevent default on select elements
        const rect = canvas.getBoundingClientRect();
        // Only start drag if inside canvas
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
            return; 
        }
        
        const mode = getCameraMode();
        if (mode === "orbit") {
            u_last = mapEventCoordsToSphere(event);
        }
        else if (mode === "dolly") {
            y_last = event.clientY;
        }
        else if (mode === "pan") {
            y_last = event.clientY;
            x_last = event.clientX;
        }
        isDragging = true;
    });

    canvas.addEventListener("mousemove", function (event) {
        if (!isDragging) return;
        event.preventDefault();
        
        const mode = getCameraMode();
        
        if (mode === "orbit") {
            const v = mapEventCoordsToSphere(event);
            q_inc.make_rot_vec2vec(v, u_last);
            q_rot = q_rot.multiply(q_inc);
            u_last = v;
        }
        else if (mode === "dolly") {
            const dy = event.clientY - y_last;
            y_last = event.clientY;
            zEye += dy * dollySpeed;
            zEye = Math.max(0.1, zEye); // Prevent going through object
        }
        else if (mode === "pan") {
            const dx = event.clientX - x_last;
            const dy = event.clientY - y_last; // Y grows down in screen space
            
            // Panning moves the "at" point and "eye" point in camera plane
            // We accumulate this displacement
            xpan -= dx * panSpeed; // Drag scene with mouse
            ypan += dy * panSpeed; // Drag scene with mouse (up is +Y)
            
            y_last = event.clientY;
            x_last = event.clientX;
        }

        requestAnimationFrame(render);
    });

    canvas.addEventListener("mouseup", function (event) {
        isDragging = false;
    });
    
    canvas.addEventListener("mouseleave", function (event) {
        isDragging = false;
    });


    function render() {
        const {
            emittedRadiance,
            ambientRadiance,
            diffuse,
            specular,
            shininess
        } = getOptions();

        // Calculate Pan Displacement Vector in World Space
        // We need to rotate the pan axes (1,0,0) and (0,1,0) by the current rotation
        const panX = scale(xpan, q_rot.apply(vec3(1, 0, 0)));
        const panY = scale(ypan, q_rot.apply(vec3(0, 1, 0)));
        const panVec = add(panX, panY);
        
        // Displaced center of rotation
        const center = add(at, panVec);

        // Displaced eye position
        // Rotate (0,0,zEye) then add the displaced center
        const eyeRotated = q_rot.apply(vec3(0, 0, zEye));
        const eye = add(center, eyeRotated);
        
        // Up vector also needs rotation
        const upRotated = q_rot.apply(up);

        const V = lookAt(eye, center, upRotated);
        const mvp = mult(projection, mult(V, M));

        const uniformFloats = new Float32Array([
            ...flatten(eye), // Pass world space eye for specular
            emittedRadiance,
            ambientRadiance,
            diffuse,
            specular,
            shininess,
        ]);
        device.queue.writeBuffer(uniformBuffer, 0, uniformFloats);
        device.queue.writeBuffer(uniformBuffer, 4 * 8, flatten(mvp));

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

    setupInputListeners(() => { requestAnimationFrame(render); });
    render();
}

window.onload = function () { main(); }