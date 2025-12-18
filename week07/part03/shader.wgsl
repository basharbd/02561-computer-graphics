struct Uniforms {
    mvp: mat4x4f,        // model-view-projection
    mtex: mat4x4f,       // texture-direction transform
    eye: vec3f,          // camera position (world)
    reflective: u32,     // 0: show normal lookup, 1: show reflection lookup
}

const pi = radians(180.0); // unused constant (kept as-is)

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var cubeMap: texture_cube<f32>;

struct VSOut {
    @builtin(position) position: vec4f, // clip-space position
    @location(0) texCoord: vec4f,       // direction-like vector for cubemap sampling
}

@vertex
fn main_vs(@location(0) inPos: vec4f, @builtin(instance_index) instance: u32) -> VSOut {
    var vsOut: VSOut;
    // transform position to clip space
    vsOut.position = uniforms.mvp * inPos;
    // transform to get cubemap lookup vector (sphere vs background)
    vsOut.texCoord = uniforms.mtex * inPos;
    return vsOut;
}

@fragment
fn main_fs(@location(0) texCoord: vec4f) -> @location(0) vec4f {
    // base lookup direction
    let coord = normalize(texCoord.xyz);

    // incident vector from eye towards current direction
    let incident = normalize(texCoord.xyz - uniforms.eye);

    // reflected lookup direction
    let reflectDir = reflect(incident, coord);

    // choose normal lookup or reflection lookup
    let coordFinal = select(coord, reflectDir, uniforms.reflective == 1u);

    // sample cubemap
    let texColor = textureSample(cubeMap, mySampler, coordFinal);
    return texColor;
}
