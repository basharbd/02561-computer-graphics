"use strict";

function add_point(array, point, size) {
    const offset = size / 2;
    var point_coords = [vec2(point[0] - offset, point[1] - offset), vec2(point[0] + offset, point[1] - offset),
    vec2(point[0] - offset, point[1] + offset), vec2(point[0] - offset, point[1] + offset),
    vec2(point[0] + offset, point[1] - offset), vec2(point[0] + offset, point[1] + offset)];
    array.push.apply(array, point_coords);
}

/**
 * 
 * @param {any[]} positions 
 * @param {Uint32Array} indices 
 */
function subdivideSphere(positions, indices) {
    const triangles = indices.length / 3;
    let newIndices = [];
    for (let i = 0; i < triangles; ++i) {
        const i0 = indices[i * 3 + 0]
        const i1 = indices[i * 3 + 1]
        const i2 = indices[i * 3 + 2]
        const c01 = positions.length;
        const c12 = positions.length + 1;
        const c20 = positions.length + 2;
        positions.push(normalize(add(positions[i0], positions[i1])))
        positions.push(normalize(add(positions[i1], positions[i2])))
        positions.push(normalize(add(positions[i2], positions[i0])))
        newIndices.push(i0, c01, c20, c20, c01, c12, c12, c01, i1, c20, c12, i2);
    }
    return newIndices;
}

function subdivideIndices(indices) {
    const triangles = indices.length / 3;
    let newIndices = [];
    for (let i = 0; i < triangles; ++i) {
        const i0 = indices[i * 3 + 0];
        const i1 = indices[i * 3 + 1];
        const i2 = indices[i * 3 + 2];
        const c01 = triangles + i * 3 + 0;
        const c12 = triangles + i * 3 + 1;
        const c20 = triangles + i * 3 + 2;
        newIndices.push(i0, c01, c20, c20, c01, c12, c12, c01, i1, c20, c12, i2);
    }
    return newIndices;
}

function courseIndices(indices) {
    const triangles = indices.length / 12;
    let newIndices = [];
    for (let i = 0; i < triangles; ++i) {
        let i0 = indices[i * 12 + 0];
        let i1 = indices[i * 12 + 8];
        let i2 = indices[i * 12 + 11];
        newIndices.push(i0, i1, i2);
    }
    return newIndices;
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

    const M_SQRT2 = Math.sqrt(2.0);
    const M_SQRT6 = Math.sqrt(6.0);
    let positions = [
        vec3(0.0, 0.0, 1.0),
        vec3(0.0, 2.0 * M_SQRT2 / 3.0, -1.0 / 3.0),
        vec3(-M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
        vec3(M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
    ];

    let indices = new Uint32Array([
        0, 1, 2, // front
        0, 3, 1, // right
        1, 3, 2, // left
        0, 2, 3, // bottom
    ]);

    const maxSubdivisions = 8;
    const minSubdivisions = 0;
    let subdivisions = 0;
    let calculatedSubdivisions = subdivisions;
    const valueText = document.getElementById('value');
    valueText.textContent = subdivisions;

    document.getElementById('plus').onclick = () => {
        if (subdivisions < maxSubdivisions) {
            subdivisions++;
            valueText.textContent = subdivisions;
            if (subdivisions > calculatedSubdivisions) {
                indices = new Uint32Array(subdivideSphere(positions, indices));
                calculatedSubdivisions++;
            } else {
                indices = new Uint32Array(subdivideIndices(indices));
            }
            requestAnimationFrame(render);
        }
    };
    document.getElementById('minus').onclick = () => {
        if (subdivisions > minSubdivisions) {
            subdivisions--;
            valueText.textContent = subdivisions;
            indices = new Uint32Array(courseIndices(indices));
            requestAnimationFrame(render);
        }
    };
    valueText.textContent = subdivisions;

    const emittedRadianceSlider = document.getElementById('emitted-radiance');
    const ambientRadianceSlider = document.getElementById('ambient-radiance');
    const diffuseSlider = document.getElementById('diffuse');
    const specularSlider = document.getElementById('specular');
    const shininessSlider = document.getElementById('shininess');

    let emittedRadiance = parseFloat(emittedRadianceSlider.value);
    let ambientRadiance = parseFloat(ambientRadianceSlider.value);
    let diffuse = parseFloat(diffuseSlider.value);
    let specular = parseFloat(specularSlider.value);
    let shininess = parseFloat(shininessSlider.value);

    emittedRadianceSlider.oninput = () => {
        emittedRadiance = parseFloat(emittedRadianceSlider.value);
        requestAnimationFrame(render);
    };
    ambientRadianceSlider.oninput = () => {
        ambientRadiance = parseFloat(ambientRadianceSlider.value);
        requestAnimationFrame(render);
    };
    diffuseSlider.oninput = () => {
        diffuse = parseFloat(diffuseSlider.value);
        requestAnimationFrame(render);
    };
    specularSlider.oninput = () => {
        specular = parseFloat(specularSlider.value);
        requestAnimationFrame(render);
    };
    shininessSlider.oninput = () => {
        shininess = parseFloat(shininessSlider.value);
        requestAnimationFrame(render);
    };

    let shouldAnimate = false;
    document.getElementById('toggle-animate').onclick = () => {
        shouldAnimate = !shouldAnimate;
        if (shouldAnimate) {
            lastTime = performance.now();
            requestAnimationFrame(animate);
        }
    };

    // Create position buffer
    const positionBuffer = device.createBuffer({
        size: sizeof['vec3'] * 4 ** (maxSubdivisions + 1),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const positionBufferLayout = {
        arrayStride: sizeof['vec3'],
        attributes: [{
            format: 'float32x3',
            offset: 0,
            shaderLocation: 0, // Position, see vertex shader
        }],
    };

    // Create index buffer
    const indicesBuffer = device.createBuffer({
        size: sizeof['vec3'] * 4 ** (maxSubdivisions + 1),
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });

    const bgcolor = vec4(0.3921, 0.5843, 0.9294, 1.0) // Cornflower

    // Matrix setup
    const Mst = mat4(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
    )

    const center = translate(0, 0, 0);
    const M = center;

    let projection = perspective(45, canvas.width / canvas.height, 0.1, 100);
    projection = mult(Mst, projection);

    const r = 4;
    let angle = 0;

    const uniformBuffer = device.createBuffer({
        size: 4 * 8 + sizeof['mat4'],
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Load WGSL code
    const wgslfile = document.getElementById('wgsl').src;
    const wgslcode
        = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({
        code: wgslcode
    });

    const msaaCount = 4;

    // Create pipeline
    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs',
            buffers: [positionBufferLayout],
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


    function render() {
        const eye = vec3(r * Math.sin(angle), 0, r * Math.cos(angle));
        const V = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));
        const mvp = mult(projection, mult(V, M));

        const uniformFloats = new Float32Array([
            ...flatten(eye),
            emittedRadiance,
            ambientRadiance,
            diffuse,
            specular,
            shininess,
        ]);
        device.queue.writeBuffer(uniformBuffer, 0, uniformFloats);
        device.queue.writeBuffer(uniformBuffer, 4 * 8, flatten(mvp));
        device.queue.writeBuffer(positionBuffer, 0, flatten(positions));
        device.queue.writeBuffer(indicesBuffer, 0, indices);

        // Create a render pass in a command buffer and submit it
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

        // Insert render pass commands here
        pass.setPipeline(pipeline);
        pass.setIndexBuffer(indicesBuffer, 'uint32');
        pass.setVertexBuffer(0, positionBuffer);
        pass.setBindGroup(0, bindGroup);
        pass.drawIndexed(indices.length);

        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    let lastTime = performance.now();

    function animate(timestamp) {
        angle += (timestamp - lastTime) * 0.0025;
        lastTime = timestamp;

        render();
        if (shouldAnimate) {
            requestAnimationFrame(animate);
        }
    }

    render();
}

window.onload = function () { main(); }