// Uniform: translation offset (use x,y; kept as vec4 for alignment)
struct Uniforms {
  offset : vec4f,   // (x, y, z, _)
};

@group(0) @binding(0) var<uniform> U : Uniforms;

// Vertex shader output: clip-space position + interpolated color
struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec3f,
};

@vertex
fn main_vs(
  @location(0) inPos : vec2f,     // input position (NDC)
  @location(1) inColor : vec3f    // input RGB color
) -> VSOut {
  var out : VSOut;

  // Apply 2D translation using the uniform offset
  let p = vec2f(inPos.x + U.offset.x, inPos.y + U.offset.y);

  out.position = vec4f(p, 0.0, 1.0); // output clip-space position
  out.color = inColor;              // pass color to fragment (will interpolate)
  return out;
}

@fragment
fn main_fs(@location(0) c : vec3f) -> @location(0) vec4f {
  // Output interpolated vertex color
  return vec4f(c, 1.0);
}
