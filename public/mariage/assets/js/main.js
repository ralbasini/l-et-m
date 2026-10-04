/*
	Highlights by HTML5 UP
	html5up.net | @ajlkn
	Free for personal and commercial use under the CCA 3.0 license (html5up.net/license)
*/

(function($) {

	var	$window = $(window),
		$body = $('body'),
		$html = $('html');

	// Breakpoints.
		breakpoints({
			large:   [ '981px',  '1680px' ],
			medium:  [ '737px',  '980px'  ],
			small:   [ '481px',  '736px'  ],
			xsmall:  [ null,     '480px'  ]
		});

	// Fade between the existing wedding photos in the Mariage hero.
		var heroLayers = document.querySelectorAll('#header .mariage-hero-image'),
			heroImageBase = new URL('../../images/', document.currentScript.src).href,
			heroPhotos = ['Bizerte.jpg', 'la_2.jpg', 'plage.jpg'].map(function(file) {
				return heroImageBase + file;
			}),
			// Random starting photo on every page view; the fade then cycles
			// through the rest in order.
			heroPhotoIndex = Math.floor(Math.random() * heroPhotos.length),
			activeHeroLayer = 0;

		if (heroLayers.length === 2) {
			heroLayers[0].style.backgroundImage = 'url("' + heroPhotos[heroPhotoIndex] + '")';

			if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
				heroPhotos.forEach(function(src, i) {
					if (i === heroPhotoIndex) return;
					var image = new Image();
					image.src = src;
				});

				window.setInterval(function() {
					var nextLayerIndex = 1 - activeHeroLayer,
						nextPhotoIndex = (heroPhotoIndex + 1) % heroPhotos.length,
						nextLayer = heroLayers[nextLayerIndex];

					nextLayer.style.backgroundImage = 'url("' + heroPhotos[nextPhotoIndex] + '")';
					nextLayer.classList.add('is-active');
					heroLayers[activeHeroLayer].classList.remove('is-active');
					heroPhotoIndex = nextPhotoIndex;
					activeHeroLayer = nextLayerIndex;
				}, 7000);
			}
		}

	// Play initial animations on page load.
		$window.on('load', function() {
			window.setTimeout(function() {
				$body.removeClass('is-preload');
			}, 100);
		});

	// Touch mode.
		if (browser.mobile) {

			var $wrapper;

			// Create wrapper.
				$body.wrapInner('<div id="wrapper" />');
				$wrapper = $('#wrapper');
				$wrapper.children('.site-nav').appendTo($body);

				// Hack: iOS vh bug.
					if (browser.os == 'ios')
						$wrapper
							.css('margin-top', -25)
							.css('padding-bottom', 25);

				// Pass scroll event to window.
					$wrapper.on('scroll', function() {
						$window.trigger('scroll');
					});

			// Scrolly.
				$window.on('load.hl_scrolly', function() {

					$('.scrolly').scrolly({
						speed: 100,
						parent: $wrapper,
						pollOnce: true
					});

					$window.off('load.hl_scrolly');

				});

			// Enable touch mode.
				$html.addClass('is-touch');

		}
		else {

			// Scrolly.
				$('.scrolly').scrolly({
					speed: 100
				});

		}

	// Header.
		var $header = $('#header'),
			$headerTitle = $header.find('header'),
			$headerContainer = $header.find('.container');

		// Make title fixed.
			if (!browser.mobile) {

				$window.on('load.hl_headerTitle', function() {

					breakpoints.on('>medium', function() {

						$headerTitle
							.css('position', 'fixed')
							.css('height', 'auto')
							.css('top', '50%')
							.css('left', '0')
							.css('width', '100%')
							.css('margin-top', ($headerTitle.outerHeight() / -2));

					});

					breakpoints.on('<=medium', function() {

						$headerTitle
							.css('position', '')
							.css('height', '')
							.css('top', '')
							.css('left', '')
							.css('width', '')
							.css('margin-top', '');

					});

					$window.off('load.hl_headerTitle');

				});

			}

		// Scrollex.
			breakpoints.on('>small', function() {
				$header.scrollex({
					terminate: function() {

						$headerTitle.css('opacity', '');

					},
					scroll: function(progress) {

						// Fade out title as user scrolls down.
							if (progress > 0.5)
								x = 1 - progress;
							else
								x = progress;

							$headerTitle.css('opacity', Math.max(0, Math.min(1, x * 2)));

					}
				});
			});

			breakpoints.on('<=small', function() {

				$header.unscrollex();

			});

	// Main sections.
		$('.main').each(function() {

			var $this = $(this),
				$primaryImg = $this.find('.image.primary > img'),
				$bg,
				options;

			// No primary image? Bail.
				if ($primaryImg.length == 0)
					return;

			// Create bg and append it to body.
				// Resolve from the page URL so any deployed base path is
				// retained; this div is appended to <body>, not the stylesheet.
				$bg = $('<div class="main-bg" id="' + $this.attr('id') + '-bg"></div>')
					.css('background-image', (
						'url("mariage/assets/css/images/overlay.png"), url("' + $primaryImg.attr('src') + '")'
					))
					.appendTo($body);

			// Scrollex.
				$this.scrollex({
					mode: 'middle',
					delay: 200,
					top: '-10vh',
					bottom: '-10vh',
					init: function() { $bg.removeClass('active'); },
					enter: function() { $bg.addClass('active'); },
					leave: function() { $bg.removeClass('active'); }
				});

		});

})(jQuery);