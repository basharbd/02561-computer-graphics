struct Uniforms {
    // ------------------------------------------------------------
    // MVP matrix (Model * View * Projection):
    // Transforms each vertex from object/world space into clip space.
    // ------------------------------------------------------------
    mvp: mat4x4f,

    // ------------------------------------------------------------
    // Visibility factor used as a simple brightness multiplier.
    // Typical usage:
    //   1.0  -> fully visible (no darkening)
    //   0.0  -> fully dark (black)
    // Values in-between dim the sampled texture.
    // ------------------------------------------------------------
    visibility: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@group(0) @binding(1) var ourSampler: sampler;
@group(0) @binding(2) var ourTexture: texture_2d<f32>;

struct VSOut {
    // ------------------------------------------------------------
    // Clip-space position output required by the rasterizer.
    // ------------------------------------------------------------
    @builtin(position) position: vec4f,

    // ------------------------------------------------------------
    // Interpolated texture coordinates passed to the fragment shader.
    // ------------------------------------------------------------
    @location(0) texCoord: vec2f,
}

@vertex
fn main_vs(
    // ------------------------------------------------------------
    // Per-vertex attributes:
    // - inPos: vertex position (vec4)
    // - texCoord: UV coordinates (vec2)
    // ------------------------------------------------------------
    @location(0) inPos: vec4f,
    @location(1) texCoord: vec2f,

    // ------------------------------------------------------------
    // Instance index is provided by WebGPU when drawing instanced.
    // Not used here, but kept in the signature for consistency.
    // ------------------------------------------------------------
    @builtin(instance_index) instance: u32
) -> VSOut {
    var vsOut: VSOut;

    // ------------------------------------------------------------
    // Transform the vertex into clip space using the MVP matrix.
    // ------------------------------------------------------------
    vsOut.position = uniforms.mvp * inPos;

    // ------------------------------------------------------------
    // Pass through UVs to be interpolated across the triangle.
    // ------------------------------------------------------------
    vsOut.texCoord = texCoord;

    return vsOut;
}

@fragment
fn main_fs(
    // ------------------------------------------------------------
    // Interpolated UVs arriving from the vertex shader.
    // ------------------------------------------------------------
    @location(0) texCoords: vec2f
) -> @location(0) vec4f {
    // ------------------------------------------------------------
    // Sample the texture using the provided sampler and UVs.
    // ------------------------------------------------------------
    let texColor = textureSample(ourTexture, ourSampler, texCoords);

    // ------------------------------------------------------------
    // Apply visibility as a grayscale multiplier to RGB.
    // Alpha is forced to 1.0 (opaque output).
    // ------------------------------------------------------------
    return texColor * vec4f(
        uniforms.visibility,
        uniforms.visibility,
        uniforms.visibility,
        1.0
    );
}
