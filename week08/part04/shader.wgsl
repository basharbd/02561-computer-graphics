// ------------------------------------------------------------
// Uniform buffer layout (matches what JS uploads):
//   - mvp: transforms object-space positions into clip space
//   - visibility: scalar used to darken (or keep) the sampled color
// Notes:
//   - visibility is a single f32, so in JS you typically pad the UBO
//     to 16-byte alignment when allocating the uniform buffer.
// ------------------------------------------------------------
struct Uniforms {
    mvp: mat4x4f,
    visibility: f32,
}

// ------------------------------------------------------------
// Bindings (group 0):
//   binding(0): uniform buffer (MVP + visibility)
//   binding(1): sampler used for filtering/addressing the texture
//   binding(2): 2D texture (ground texture or "red" texture depending on bind group)
// ------------------------------------------------------------
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var ourSampler: sampler;
@group(0) @binding(2) var ourTexture: texture_2d<f32>;

// ------------------------------------------------------------
// Vertex shader output:
//   - position: required clip-space position for rasterization
//   - texCoord: UV passed to fragment shader (interpolated per-fragment)
// ------------------------------------------------------------
struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) texCoord: vec2f,
}

// ------------------------------------------------------------
// Vertex shader:
//   Inputs:
//     @location(0) inPos    : vertex position (vec4f)
//     @location(1) texCoord : vertex UV (vec2f)
//     @builtin(instance_index) instance : available for instancing (unused here)
//   Work:
//     - Apply MVP to send position into clip space
//     - Pass UV through to the fragment stage
// ------------------------------------------------------------
@vertex
fn main_vs(
    @location(0) inPos: vec4f,
    @location(1) texCoord: vec2f,
    @builtin(instance_index) instance: u32
) -> VSOut {
    var vsOut: VSOut;
    vsOut.position = uniforms.mvp * inPos;
    vsOut.texCoord = texCoord;
    return vsOut;
}

// ------------------------------------------------------------
// Fragment shader:
//   - Samples the bound texture at the interpolated UV
//   - Multiplies RGB by "visibility" to darken shadows / preserve lit areas
//   - Uses a fixed alpha (shadow_alpha) to support blended shadows
//     (your pipeline sets blending so alpha controls shadow opacity)
// ------------------------------------------------------------
@fragment
fn main_fs(@location(0) texCoords: vec2f) -> @location(0) vec4f {
    // Shadow transparency factor:
    //  - 0.0  => fully transparent (no visible shadow)
    //  - 1.0  => fully opaque (solid dark overlay)
    // Here 0.6 gives a semi-transparent shadow.
    const shadow_alpha: f32 = 0.6;

    // Pack visibility into a vec4:
    //   RGB = uniforms.visibility (typically 1.0 for normal draw, <1 for shadow darkening)
    //   A   = shadow_alpha (controls blending strength in the shadow pipeline)
    let visibility: vec4f = vec4f(vec3f(uniforms.visibility), shadow_alpha);

    // Final color:
    //   sampled texture color (RGBA) multiplied by visibility term.
    // For the ground: texture is xamp23.png, visibility usually 1.0
    // For shadows: texture may be a solid color, visibility typically < 1.0
    return textureSample(ourTexture, ourSampler, texCoords) * visibility;
}
