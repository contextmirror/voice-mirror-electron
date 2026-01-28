//! Orb rendering using raw pixel manipulation.
//!
//! Draws a circular orb with gradient and animation effects directly
//! into a Wayland SHM buffer (ARGB8888, premultiplied alpha).

use crate::ipc::OrbState;

/// Render the orb into a raw ARGB8888 buffer.
pub fn render_orb(canvas: &mut [u8], width: u32, height: u32, state: OrbState, phase: f32) {
    let cx = width as f32 / 2.0;
    let cy = height as f32 / 2.0;
    let max_radius = (width.min(height) as f32 / 2.0) - 1.0;

    // Animation scale
    let scale = match state {
        OrbState::Idle => 1.0 + 0.05 * (phase * std::f32::consts::TAU).sin(),
        OrbState::Recording => 1.0 + 0.12 * (phase * std::f32::consts::TAU).sin(),
        OrbState::Speaking => {
            if phase < 0.5 {
                1.0 + 0.08 * (phase * 2.0 * std::f32::consts::TAU).sin()
            } else {
                1.0 - 0.05 * ((phase - 0.5) * 2.0 * std::f32::consts::TAU).sin()
            }
        }
        OrbState::Thinking => 1.0,
    };

    let radius = max_radius * scale.clamp(0.5, 1.0);
    let border_radius = radius;
    let inner_radius = radius - 2.0;

    // Rotation for thinking state (rotates the gradient)
    let rotation = match state {
        OrbState::Thinking => phase * std::f32::consts::TAU,
        _ => 0.0,
    };

    for y in 0..height {
        for x in 0..width {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            let dx = px - cx;
            let dy = py - cy;
            let dist = (dx * dx + dy * dy).sqrt();

            let pixel_offset = ((y * width + x) * 4) as usize;
            if pixel_offset + 3 >= canvas.len() {
                continue;
            }

            if dist > border_radius + 0.5 {
                // Outside the orb - fully transparent
                canvas[pixel_offset] = 0;     // B
                canvas[pixel_offset + 1] = 0; // G
                canvas[pixel_offset + 2] = 0; // R
                canvas[pixel_offset + 3] = 0; // A
                continue;
            }

            // Anti-aliased edge
            let edge_alpha = if dist > border_radius - 0.5 {
                1.0 - (dist - (border_radius - 0.5))
            } else {
                1.0
            };

            let (r, g, b, a) = if dist > inner_radius {
                // Border ring: purple-blue glow
                let border_alpha = edge_alpha * 0.5;
                apply_state_color(102, 126, 234, border_alpha, state, phase)
            } else {
                // Inner gradient: dark purple
                let t = dist / inner_radius; // 0=center, 1=edge

                // Apply rotation for thinking state
                let (_rdx, _rdy) = if rotation != 0.0 {
                    let cos_r = rotation.cos();
                    let sin_r = rotation.sin();
                    (dx * cos_r - dy * sin_r, dx * sin_r + dy * cos_r)
                } else {
                    (dx, dy)
                };

                // Radial gradient: center bright, edge dark
                let r_val = lerp(0x2d, 0x0d, t);
                let g_val = lerp(0x1b, 0x0d, t);
                let b_val = lerp(0x4e, 0x1a, t);

                apply_state_color(r_val, g_val, b_val, edge_alpha * 0.95, state, phase)
            };

            // ARGB8888 premultiplied alpha (little-endian: B, G, R, A)
            let pa = (a * 255.0) as u8;
            let pr = (r * a * 255.0) as u8;
            let pg = (g * a * 255.0) as u8;
            let pb = (b * a * 255.0) as u8;

            canvas[pixel_offset] = pb;
            canvas[pixel_offset + 1] = pg;
            canvas[pixel_offset + 2] = pr;
            canvas[pixel_offset + 3] = pa;
        }
    }

    // Overlay state-specific icon
    match state {
        OrbState::Recording => {
            draw_human_icon(canvas, width, height, cx, cy, inner_radius, state, phase);
        }
        OrbState::Speaking => {
            draw_robot_icon(canvas, width, height, cx, cy, inner_radius, state, phase);
        }
        _ => {}
    }
}

/// Apply state-dependent color modifications (hue shift, brightness).
fn apply_state_color(
    r: u8,
    g: u8,
    b: u8,
    alpha: f32,
    state: OrbState,
    _phase: f32,
) -> (f32, f32, f32, f32) {
    let mut rf = r as f32 / 255.0;
    let mut gf = g as f32 / 255.0;
    let mut bf = b as f32 / 255.0;

    match state {
        OrbState::Idle => {
            // No color shift
        }
        OrbState::Recording => {
            // Shift toward pink/red: increase red, decrease blue
            rf = (rf * 1.3 + 0.1).min(1.0);
            gf *= 0.7;
        }
        OrbState::Speaking => {
            // Shift toward blue/cyan: increase blue, decrease red
            bf = (bf * 1.2 + 0.1).min(1.0);
            gf = (gf * 1.1 + 0.05).min(1.0);
            rf *= 0.8;
        }
        OrbState::Thinking => {
            // Shift toward teal/green
            gf = (gf * 1.2 + 0.1).min(1.0);
            bf = (bf * 1.1).min(1.0);
            rf *= 0.6;
        }
    }

    (rf, gf, bf, alpha)
}

/// Linear interpolation between two u8 values.
fn lerp(a: u8, b: u8, t: f32) -> u8 {
    let result = a as f32 * (1.0 - t) + b as f32 * t;
    result.clamp(0.0, 255.0) as u8
}

/// Draw a human silhouette icon (head circle + shoulder arc) into the orb.
/// Coordinates are normalized 0.0–1.0 relative to the orb interior.
fn draw_human_icon(canvas: &mut [u8], width: u32, height: u32, cx: f32, cy: f32, inner_radius: f32, state: OrbState, phase: f32) {
    let icon_scale = inner_radius * 0.55;

    // Head: circle centered above middle
    let head_cy = cy - icon_scale * 0.3;
    let head_r = icon_scale * 0.32;

    // Shoulders: arc below head
    let body_cy = cy + icon_scale * 0.35;
    let body_rx = icon_scale * 0.55; // horizontal radius
    let body_ry = icon_scale * 0.45; // vertical radius

    for y in 0..height {
        for x in 0..width {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;

            // Check if inside the orb circle first
            let odx = px - cx;
            let ody = py - cy;
            let odist = (odx * odx + ody * ody).sqrt();
            if odist > inner_radius {
                continue;
            }

            let mut icon_alpha: f32 = 0.0;

            // Head circle
            let hdx = px - cx;
            let hdy = py - head_cy;
            let hdist = (hdx * hdx + hdy * hdy).sqrt();
            if hdist < head_r + 0.5 {
                icon_alpha = if hdist > head_r - 0.5 {
                    1.0 - (hdist - (head_r - 0.5))
                } else {
                    1.0
                };
            }

            // Shoulders: upper half of ellipse, clipped to below neck
            if py > head_cy + head_r * 0.5 {
                let sdx = (px - cx) / body_rx;
                let sdy = (py - body_cy) / body_ry;
                let sdist = (sdx * sdx + sdy * sdy).sqrt();
                // Only the upper part of the ellipse (above center)
                if sdist < 1.0 + 0.5 / body_rx && py < body_cy + body_ry * 0.15 {
                    let shoulder_alpha = if sdist > 1.0 - 0.5 / body_rx {
                        1.0 - (sdist - (1.0 - 0.5 / body_rx)) * body_rx
                    } else {
                        1.0
                    };
                    icon_alpha = icon_alpha.max(shoulder_alpha.clamp(0.0, 1.0));
                }
            }

            if icon_alpha > 0.0 {
                let pixel_offset = ((y * width + x) * 4) as usize;
                if pixel_offset + 3 >= canvas.len() {
                    continue;
                }

                // Use the state color for the icon (lighter version)
                let (ir, ig, ib, _) = apply_state_color(220, 220, 240, 1.0, state, phase);
                let a = icon_alpha * 0.85;

                // Blend over existing pixel (premultiplied alpha compositing)
                let existing_b = canvas[pixel_offset] as f32;
                let existing_g = canvas[pixel_offset + 1] as f32;
                let existing_r = canvas[pixel_offset + 2] as f32;
                let existing_a = canvas[pixel_offset + 3] as f32;

                let src_r = ir * a * 255.0;
                let src_g = ig * a * 255.0;
                let src_b = ib * a * 255.0;
                let src_a = a * 255.0;

                canvas[pixel_offset]     = (src_b + existing_b * (1.0 - a)).min(255.0) as u8;
                canvas[pixel_offset + 1] = (src_g + existing_g * (1.0 - a)).min(255.0) as u8;
                canvas[pixel_offset + 2] = (src_r + existing_r * (1.0 - a)).min(255.0) as u8;
                canvas[pixel_offset + 3] = (src_a + existing_a * (1.0 - a)).min(255.0) as u8;
            }
        }
    }
}

/// Draw a robot icon (square head with antenna + two eyes) into the orb.
fn draw_robot_icon(canvas: &mut [u8], width: u32, height: u32, cx: f32, cy: f32, inner_radius: f32, state: OrbState, phase: f32) {
    let icon_scale = inner_radius * 0.5;

    // Robot head: rounded rectangle
    let head_w = icon_scale * 0.7;
    let head_h = icon_scale * 0.55;
    let head_cy = cy + icon_scale * 0.05;
    let head_corner_r = icon_scale * 0.1;

    // Antenna
    let antenna_x = cx;
    let antenna_top = head_cy - head_h - icon_scale * 0.25;
    let antenna_bottom = head_cy - head_h;
    let antenna_w = icon_scale * 0.06;
    let antenna_ball_r = icon_scale * 0.1;

    // Eyes
    let eye_y = head_cy - head_h * 0.15;
    let eye_spacing = head_w * 0.4;
    let eye_r = icon_scale * 0.12;

    // Body: rectangle below head
    let body_top = head_cy + head_h + icon_scale * 0.05;
    let body_w = head_w * 0.85;
    let body_h = icon_scale * 0.35;
    let body_corner_r = icon_scale * 0.06;

    for y in 0..height {
        for x in 0..width {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;

            // Inside orb?
            let odx = px - cx;
            let ody = py - cy;
            if (odx * odx + ody * ody).sqrt() > inner_radius {
                continue;
            }

            let mut icon_alpha: f32 = 0.0;

            // Antenna stick
            if (px - antenna_x).abs() < antenna_w && py >= antenna_top && py <= antenna_bottom {
                icon_alpha = 1.0;
            }

            // Antenna ball
            let adx = px - antenna_x;
            let ady = py - antenna_top;
            let adist = (adx * adx + ady * ady).sqrt();
            if adist < antenna_ball_r + 0.5 {
                let aa = if adist > antenna_ball_r - 0.5 { 1.0 - (adist - (antenna_ball_r - 0.5)) } else { 1.0 };
                icon_alpha = icon_alpha.max(aa.clamp(0.0, 1.0));
            }

            // Head (rounded rect)
            let in_head = rounded_rect_sdf(px - cx, py - head_cy, head_w, head_h, head_corner_r);
            if in_head < 0.5 {
                let ha = if in_head > -0.5 { 0.5 - in_head } else { 1.0 };
                icon_alpha = icon_alpha.max(ha.clamp(0.0, 1.0));
            }

            // Eyes: draw as dark circles (cutout)
            let mut is_eye = false;
            for &ex in &[cx - eye_spacing, cx + eye_spacing] {
                let edx = px - ex;
                let edy = py - eye_y;
                let edist = (edx * edx + edy * edy).sqrt();
                if edist < eye_r + 0.5 {
                    is_eye = true;
                }
            }

            // Body (rounded rect)
            let in_body = rounded_rect_sdf(px - cx, py - (body_top + body_h), body_w, body_h, body_corner_r);
            if in_body < 0.5 {
                let ba = if in_body > -0.5 { 0.5 - in_body } else { 1.0 };
                icon_alpha = icon_alpha.max(ba.clamp(0.0, 1.0));
            }

            if icon_alpha > 0.0 {
                let pixel_offset = ((y * width + x) * 4) as usize;
                if pixel_offset + 3 >= canvas.len() {
                    continue;
                }

                // Eyes are dark cutouts
                if is_eye {
                    // Draw eye as dark circle over the head
                    let (ir, ig, ib, _) = apply_state_color(20, 15, 40, 1.0, state, phase);
                    let a = 0.9;
                    let existing_b = canvas[pixel_offset] as f32;
                    let existing_g = canvas[pixel_offset + 1] as f32;
                    let existing_r = canvas[pixel_offset + 2] as f32;
                    let existing_a = canvas[pixel_offset + 3] as f32;
                    canvas[pixel_offset]     = (ib * a * 255.0 + existing_b * (1.0 - a)).min(255.0) as u8;
                    canvas[pixel_offset + 1] = (ig * a * 255.0 + existing_g * (1.0 - a)).min(255.0) as u8;
                    canvas[pixel_offset + 2] = (ir * a * 255.0 + existing_r * (1.0 - a)).min(255.0) as u8;
                    canvas[pixel_offset + 3] = (a * 255.0 + existing_a * (1.0 - a)).min(255.0) as u8;
                } else {
                    let (ir, ig, ib, _) = apply_state_color(220, 220, 240, 1.0, state, phase);
                    let a = icon_alpha * 0.85;
                    let existing_b = canvas[pixel_offset] as f32;
                    let existing_g = canvas[pixel_offset + 1] as f32;
                    let existing_r = canvas[pixel_offset + 2] as f32;
                    let existing_a = canvas[pixel_offset + 3] as f32;
                    canvas[pixel_offset]     = (ib * a * 255.0 + existing_b * (1.0 - a)).min(255.0) as u8;
                    canvas[pixel_offset + 1] = (ig * a * 255.0 + existing_g * (1.0 - a)).min(255.0) as u8;
                    canvas[pixel_offset + 2] = (ir * a * 255.0 + existing_r * (1.0 - a)).min(255.0) as u8;
                    canvas[pixel_offset + 3] = (a * 255.0 + existing_a * (1.0 - a)).min(255.0) as u8;
                }
            }
        }
    }
}

/// Signed distance field for a rounded rectangle centered at origin.
/// Returns negative inside, positive outside.
fn rounded_rect_sdf(px: f32, py: f32, half_w: f32, half_h: f32, corner_r: f32) -> f32 {
    let qx = px.abs() - half_w + corner_r;
    let qy = py.abs() - half_h + corner_r;
    let outside = (qx.max(0.0) * qx.max(0.0) + qy.max(0.0) * qy.max(0.0)).sqrt();
    let inside = qx.max(qy).min(0.0);
    outside + inside - corner_r
}
